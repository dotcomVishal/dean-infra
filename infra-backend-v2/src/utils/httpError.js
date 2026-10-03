import logger, { errorFields } from './logger.js';

export const GENERIC_MESSAGE = 'Internal Server Error';

/**
 * S12: the one place a 5xx is produced. Logs full detail internally (raw SQL /
 * Firebase / driver errors included) and returns only a generic message plus
 * the request id, so the client never sees internals and support can find the
 * log line.
 *
 *   } catch (error) { return sendServerError(req, res, error, 'getQueue'); }
 */
export const sendServerError = (req, res, err, context) => {
  const requestId = req?.id;
  logger.error(context || 'unhandled error', {
    requestId,
    method: req?.method,
    path: req?.originalUrl?.split('?')[0],
    userId: req?.user?.id,
    ...errorFields(err),
  });
  if (res.headersSent) return undefined;
  return res.status(500).json({ success: false, message: GENERIC_MESSAGE, requestId });
};
