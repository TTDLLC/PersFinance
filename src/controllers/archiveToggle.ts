const appendQueryValue = (params: URLSearchParams, key: string, value: unknown) => {
  if (Array.isArray(value)) {
    value.forEach((item) => appendQueryValue(params, key, item));
    return;
  }
  if (typeof value === "string") params.append(key, value);
};

export const archiveToggleHref = (
  path: string,
  query: Record<string, unknown>,
  showArchived: boolean,
  options: { parameter?: string; aliases?: string[] } = {}
) => {
  const parameter = options.parameter ?? "showArchived";
  const archiveParameters = new Set([parameter, ...(options.aliases ?? [])]);
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (!archiveParameters.has(key)) appendQueryValue(params, key, value);
  }

  if (!showArchived) params.set(parameter, "true");

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
};
