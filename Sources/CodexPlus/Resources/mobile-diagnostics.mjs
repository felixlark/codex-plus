// Only static code locations and RPC method names leave the renderer. Exception
// messages, arguments, URLs, account values and document contents stay out of logs.
export function mobileDiagnostic(event, error) {
  const result = {event};
  const message = typeof error?.message === 'string' ? error.message : '';
  const method = message.match(/^'([a-zA-Z][a-zA-Z0-9_.]*)' is not a function\.$/)?.[1];
  if (method) result.missingMethod = method;
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const frames = [];
  for (const match of stack.matchAll(/app:\/\/-\/assets\/(?:async\/)?([0-9]+\.[a-f0-9]+\.js):([0-9]+):([0-9]+)/g)) {
    frames.push({file: match[1], line: Number(match[2]), column: Number(match[3])});
    if (frames.length === 3) break;
  }
  if (frames.length) result.frames = frames;
  return result;
}
