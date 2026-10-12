/** Body APIs have one cancellation shape even when a host aborts with a string or custom Error. */
export function throwIfReadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
