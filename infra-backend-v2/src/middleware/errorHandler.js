import { WorkflowError } from '../config/workflow.js';
import { sendServerError } from '../utils/httpError.js';

// S12: only errors we KNOW are client-safe keep their message. Anything else
// (raw SQL, Firebase, driver errors) is masked and logged with the request id.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const requestId = req.id;
  // S3: upload rejected by the file-type allow-list / size limit -> client error, not a 500.
  if (err.code === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(415).json({ success: false, code: err.code, message: err.message, requestId });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, code: err.code, message: err.message, requestId });
  }
  if (err instanceof WorkflowError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message, requestId });
  }
  // Malformed JSON / oversized body from body-parser: 4xx with expose=true.
  if (err.expose === true && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message, requestId });
  }
  return sendServerError(req, res, err, 'unhandled error');
};
