import type { NextFunction, Request, Response } from "express";

type RequestParsingError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).render("layout", {
    title: "Not Found",
    view: "partials/not-found"
  });
};

export const errorHandler = (
  error: RequestParsingError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestTooLarge = error.status === 413 || error.statusCode === 413;
  console.error("Request failed", {
    method: req.method,
    path: req.originalUrl,
    status: requestTooLarge ? 413 : 500,
    type: error.type ?? error.name,
    message: error.message
  });

  res.status(requestTooLarge ? 413 : 500).render("layout", {
    title: requestTooLarge ? "Request Too Large" : "Server Error",
    view: "partials/error",
    error,
    currentUser: req.user ?? null,
    flash: { success: [], error: [] }
  });
};
