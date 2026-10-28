using Microsoft.Extensions.Logging;

namespace DCCExpressHub.Net;

internal sealed class RuntimeLogProvider(Action<string> write) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new RuntimeLogger(categoryName, write);
    public void Dispose() { }

    private sealed class RuntimeLogger(string category, Action<string> write) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var message = $"{logLevel} {category}: {formatter(state, exception)}";
            if (exception is not null) message += Environment.NewLine + exception;
            // A closing UI must not interrupt command-center or shutdown work.
            try { write(message); }
            catch { }
        }
    }
}
