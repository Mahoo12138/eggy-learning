/** 运行器对外抛出的错误统一带 status 与 code，供 server.mjs 的 httpError 透传。 */
export function runnerError(message, code = 'runner_error', details = '') {
  return Object.assign(new Error(message), { status: 400, code, details });
}

export function isRunnerError(error, code) {
  return Boolean(error) && error.status === 400 && (code ? error.code === code : typeof error.code === 'string');
}
