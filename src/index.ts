// Library entrypoint. Consumers `import { buildFixture, scenarios } from "capture-fixtures"`.
export { buildFixture, CSP_REPORT, REQUEST_LOG_LIMIT } from "./fixture.js";
// Exported so a consumer's assertions are typed by capture-fixtures rather than by a
// hand-copied shape: renaming a field here should break their build, not
// surface as an undefined at 2am.
export type { RecordedRequest, RequestLog } from "./fixture.js";
export { scenarios, type Scenarios } from "./scenarios.js";
export { CHARSET_ECHO, CHARSET_FIXTURES, type CharsetBody, type CharsetPath } from "./charset.js";
export {
  LOGIN_DEFAULT_USER,
  LOGIN_SUBMIT,
  echoBytesBody,
  echoTextHtml,
  loginAfterHtml,
  loginSessionToken,
} from "./login-echo.js";
export {
  MARKED_CONSOLE_METHODS,
  MARKED_CONSOLE_MODES,
  MARKED_CONSOLE_WAYS,
  MARKED_KINDS,
  MARKED_WINDOW_WAYS,
  markedConsoleTokens,
  markedSearchTokens,
  markedTokens,
  type MarkedConsoleMethod,
  type MarkedConsoleMode,
  type MarkedConsoleTokens,
  type MarkedConsoleWay,
  type MarkedKind,
  type MarkedSearchTokens,
  type MarkedTokens,
  type MarkedWindowWay,
} from "./marked.js";
export {
  SCRIPT_RETINA_MIN_DPR,
  TALL_MIN_HEIGHT,
  VIEWPORT_IMAGE_NAMES,
  WIDEST_BAND,
  WIDTH_BANDS,
  viewportImages,
  type ViewportWindow,
} from "./viewport.js";
