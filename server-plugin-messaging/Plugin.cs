namespace MikeyTV.Messaging;

using System;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

/// <summary>Lets MikeyTV clients reply to messages sent from the admin dashboard.</summary>
public class Plugin : BasePlugin<BasePluginConfiguration>
{
    /// <summary>Initializes a new instance of the <see cref="Plugin"/> class.</summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    /// <inheritdoc />
    public override string Name => "MikeyTV Messaging";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("7c1e9f24-5b3a-4d86-a0f7-2e6d4b91c35a");

    /// <inheritdoc />
    public override string Description => "Shows replies from MikeyTV clients in the Activity log and to signed-in admins.";
}
