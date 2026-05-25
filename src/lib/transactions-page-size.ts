export const ALLOWED_PAGE_SIZES = [100, 500, 1000] as const
export type AllowedPageSize = typeof ALLOWED_PAGE_SIZES[number]
export const DEFAULT_PAGE_SIZE: AllowedPageSize = 100

export function sanitizePageSize(n: number | undefined): AllowedPageSize {
  return ALLOWED_PAGE_SIZES.includes(n as AllowedPageSize) ? (n as AllowedPageSize) : DEFAULT_PAGE_SIZE
}
