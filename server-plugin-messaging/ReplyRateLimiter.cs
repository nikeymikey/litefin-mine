namespace MikeyTV.Messaging;

using System;
using System.Collections.Generic;

/// <summary>Sliding-window limit per user, so replies cannot flood the Activity log.</summary>
public class ReplyRateLimiter
{
    private readonly int _limit;
    private readonly TimeSpan _window;
    private readonly Dictionary<Guid, Queue<DateTime>> _sent = new();
    private readonly object _lock = new();

    /// <summary>Initializes a new instance of the <see cref="ReplyRateLimiter"/> class.</summary>
    /// <param name="limit">Replies allowed in the window.</param>
    /// <param name="window">Window length.</param>
    public ReplyRateLimiter(int limit, TimeSpan window)
    {
        _limit = limit;
        _window = window;
    }

    /// <summary>Records a reply if the user is under the limit.</summary>
    /// <param name="userId">The user.</param>
    /// <param name="now">Current UTC time.</param>
    /// <returns>True if the reply is allowed.</returns>
    public bool TryAcquire(Guid userId, DateTime now)
    {
        lock (_lock)
        {
            if (!_sent.TryGetValue(userId, out var times))
            {
                times = new Queue<DateTime>();
                _sent[userId] = times;
            }

            while (times.Count > 0 && now - times.Peek() >= _window)
            {
                times.Dequeue();
            }

            if (times.Count >= _limit)
            {
                return false;
            }

            times.Enqueue(now);
            return true;
        }
    }
}
