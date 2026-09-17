import { useEffect, useState } from "react";

export function useAdminResource<T>(loader: (signal: AbortSignal) => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    loader(controller.signal)
      .then((result) => !controller.signal.aborted && setData(result))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "管理数据暂时不可用");
        }
      });
    return () => controller.abort();
  }, [loader]);
  return { data, error };
}
