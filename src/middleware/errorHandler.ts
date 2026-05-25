import type { NextFunction, Request, Response } from "express";

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).render("layout", {
    title: "Not Found",
    view: "partials/not-found"
  });
};

export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(error);
  res.status(500).render("layout", {
    title: "Server Error",
    view: "partials/error",
    error
  });
};
