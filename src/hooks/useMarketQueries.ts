import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Exchange, ManualStockPayload, StockAnalysis } from '../types/market';
import {
  StockNotFoundError,
  analyzeDocuments,
  analyzeManualStock,
  fetchLiveMarketFromApi,
  fetchLiveTopPicksFromApi,
  fetchMarketLive,
  fetchStockAnalysis,
  fetchTopPicks,
  getEdgeCachedStockAnalysis,
  getEdgeCachedStockAnalysisSync,
  readCachedMarketLive,
  readCachedTopPicks,
} from '../services/apiClient';
import { getBDMarketSession } from '../utils/bdMarketSession';
import { QuotaExceededError } from '../services/quotaService';

export function useMarketLive() {
  const session = getBDMarketSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['market-live'],
    queryFn: fetchMarketLive,
    placeholderData: () => readCachedMarketLive() ?? undefined,
    staleTime: 60_000,
    retry: 2,
    retryDelay: 2_500,
    refetchInterval: (q) => {
      const current = q.state.data;
      if (!current || current.status === 'offline' || current.dsex === 'সংগ্রহ হচ্ছে...') {
        return 12_000;
      }
      return session.is_live ? 60_000 : false;
    },
  });

  // Simultaneously upgrade DSEX/DS30 with live intraday data from always-awake Render backend
  useEffect(() => {
    let active = true;
    void fetchLiveMarketFromApi(15_000).then((liveTicker) => {
      if (active && liveTicker && liveTicker.dsex && liveTicker.dsex !== 'সংগ্রহ হচ্ছে...') {
        queryClient.setQueryData(['market-live'], liveTicker);
      }
    });
    return () => {
      active = false;
    };
  }, [queryClient, session.mode]);

  return query;
}

export function useTopPicks() {
  const session = getBDMarketSession();
  const queryClient = useQueryClient();
  const queryKey = ['top-picks', session.mode] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTopPicks(false),
    placeholderData: () => readCachedTopPicks() ?? undefined,
    staleTime: session.is_live ? 120_000 : 10 * 60_000,
    retry: 1,
    retryDelay: 1_500,
  });

  // Simultaneously upgrade Top 6 Setups from always-awake Render /api/top-picks
  useEffect(() => {
    let active = true;
    void fetchLiveTopPicksFromApi(20_000).then((liveResult) => {
      if (active && liveResult && liveResult.picks.length >= 6) {
        queryClient.setQueryData(queryKey, liveResult);
      } else if (active && liveResult && liveResult.picks.length > 0) {
        const existing = queryClient.getQueryData<{ picks?: unknown[] }>(queryKey);
        if (!existing?.picks || existing.picks.length === 0) {
          queryClient.setQueryData(queryKey, liveResult);
        }
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mode]);

  const refetchLive = async () => {
    const liveResult = await fetchLiveTopPicksFromApi(20_000);
    if (liveResult && liveResult.picks.length > 0) {
      queryClient.setQueryData(queryKey, liveResult);
      return liveResult;
    }
    return query.refetch();
  };

  return {
    ...query,
    refetch: refetchLive,
  };
}

export function useStockAnalysis(symbol: string, exchange: Exchange, enabled = true) {
  const cleanSym = symbol.trim().toUpperCase();
  const [edgeCachedData, setEdgeCachedData] = useState<StockAnalysis | undefined>(() =>
    enabled && cleanSym ? getEdgeCachedStockAnalysisSync(cleanSym, exchange) ?? undefined : undefined
  );

  // Instant (0ms) edge hydration from /assets/ml_analysis_cache.json when authorized
  useEffect(() => {
    if (!enabled || !cleanSym) {
      setEdgeCachedData(undefined);
      return;
    }
    const syncHit = getEdgeCachedStockAnalysisSync(cleanSym, exchange);
    if (syncHit) {
      setEdgeCachedData(syncHit);
      return;
    }
    let active = true;
    setEdgeCachedData(undefined);
    void getEdgeCachedStockAnalysis(cleanSym, exchange).then((cached) => {
      if (active && cached) {
        setEdgeCachedData(cached);
      }
    });
    return () => {
      active = false;
    };
  }, [cleanSym, exchange, enabled]);

  const liveQuery = useQuery({
    queryKey: ['stock-analysis', exchange, cleanSym],
    queryFn: () =>
      fetchStockAnalysis(cleanSym, exchange, (cached) => {
        setEdgeCachedData(cached);
      }),
    enabled: enabled && cleanSym.length > 0,
    staleTime: 180_000,
    retry: (failureCount, error) => {
      if (error instanceof QuotaExceededError || error instanceof StockNotFoundError) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(5_000, 2_500 + attemptIndex * 1_500),
  });

  // Never show cached data if the user hit the free quota limit
  const effectiveData =
    liveQuery.error instanceof QuotaExceededError
      ? undefined
      : liveQuery.data || edgeCachedData;

  return {
    ...liveQuery,
    data: effectiveData,
    isLiveRefreshing: Boolean(edgeCachedData && !liveQuery.data && liveQuery.isFetching),
  };
}

export function useManualAnalysisMutation() {
  return useMutation({
    mutationFn: (payload: ManualStockPayload) => analyzeManualStock(payload),
  });
}

export function useDocumentAnalysisMutation() {
  return useMutation({
    mutationFn: ({ files, symbol, exchange }: { files: File[]; symbol: string; exchange: Exchange }) =>
      analyzeDocuments(files, symbol, exchange),
  });
}
