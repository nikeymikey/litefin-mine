namespace MikeyTV.Messaging;

using System;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Activity;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

/// <summary>A reply from a client.</summary>
public class ReplyRequest
{
    /// <summary>Gets or sets the reply text.</summary>
    [Required]
    public string Text { get; set; } = string.Empty;

    /// <summary>Gets or sets the message being replied to, for context.</summary>
    public string? OriginalText { get; set; }
}

/// <summary>Reply channel for admin messages.</summary>
[ApiController]
[Authorize]
[Route("MikeyTV/Messages")]
public class MessagesController : ControllerBase
{
    private const int MaxReplyLength = 200;
    private const int MaxContextLength = 200;
    private const string UserIdClaim = "Jellyfin-UserId";
    private const string DeviceIdClaim = "Jellyfin-DeviceId";
    private const string WebClientName = "Jellyfin Web";

    private static readonly ReplyRateLimiter RateLimiter = new(10, TimeSpan.FromMinutes(1));

    private readonly IActivityManager _activityManager;
    private readonly ISessionManager _sessionManager;
    private readonly IUserManager _userManager;
    private readonly ILogger<MessagesController> _logger;

    /// <summary>Initializes a new instance of the <see cref="MessagesController"/> class.</summary>
    /// <param name="activityManager">Activity manager.</param>
    /// <param name="sessionManager">Session manager.</param>
    /// <param name="userManager">User manager.</param>
    /// <param name="logger">Logger.</param>
    public MessagesController(
        IActivityManager activityManager,
        ISessionManager sessionManager,
        IUserManager userManager,
        ILogger<MessagesController> logger)
    {
        _activityManager = activityManager;
        _sessionManager = sessionManager;
        _userManager = userManager;
        _logger = logger;
    }

    /// <summary>Tells the client that replies are available.</summary>
    /// <returns>The status.</returns>
    [HttpGet("Status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<object> GetStatus() => Ok(new { enabled = true });

    /// <summary>Delivers a reply to the admins.</summary>
    /// <param name="request">The reply.</param>
    /// <returns>No content on success.</returns>
    [HttpPost("Reply")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult> PostReply([FromBody] ReplyRequest request)
    {
        // The sender always comes from the login token, never from the request.
        if (!Guid.TryParse(User.FindFirst(UserIdClaim)?.Value, out var userId)
            || _userManager.GetUserById(userId) is not User user)
        {
            return Unauthorized();
        }

        var text = Clean(request.Text, MaxReplyLength);
        if (text.Length == 0)
        {
            return BadRequest("Reply is empty.");
        }

        if (!RateLimiter.TryAcquire(userId, DateTime.UtcNow))
        {
            return StatusCode(StatusCodes.Status429TooManyRequests);
        }

        var deviceId = User.FindFirst(DeviceIdClaim)?.Value;
        var deviceName = _sessionManager.Sessions
            .FirstOrDefault(s => s.UserId.Equals(userId) && string.Equals(s.DeviceId, deviceId, StringComparison.Ordinal))
            ?.DeviceName;
        var sender = string.IsNullOrEmpty(deviceName) ? user.Username : $"{user.Username} on {deviceName}";
        var original = Clean(request.OriginalText, MaxContextLength);

        // Name is limited to 512 characters by the Activity log schema.
        await _activityManager.CreateAsync(new ActivityLog($"Reply from {sender}: {text}", "MikeyTVMessageReply", userId)
        {
            ShortOverview = original.Length == 0 ? null : $"In reply to: {original}"
        }).ConfigureAwait(false);

        await NotifyAdminsAsync(sender, text).ConfigureAwait(false);
        return NoContent();
    }

    private static string Clean(string? value, int maxLength)
    {
        var flat = string.Join(' ', (value ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return flat.Length <= maxLength ? flat : flat[..maxLength];
    }

    /// <summary>
    /// Pops up on admin web sessions only, so an admin who is watching on a TV is
    /// not interrupted. The reply is in the Activity log whether or not this works.
    /// </summary>
    private async Task NotifyAdminsAsync(string sender, string text)
    {
        var command = new MessageCommand
        {
            Header = $"Reply from {sender}",
            Text = text,
            TimeoutMs = 15000
        };

        foreach (var session in _sessionManager.Sessions.Where(s => s.IsActive && s.Client == WebClientName))
        {
            if (_userManager.GetUserById(session.UserId)?.HasPermission(PermissionKind.IsAdministrator) != true)
            {
                continue;
            }

            try
            {
                await _sessionManager.SendMessageCommand(string.Empty, session.Id, command, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Could not show a reply on session {SessionId}", session.Id);
            }
        }
    }
}
