import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Exchange, ManualStockPayload } from '../types/market';
import {
  StockNotFoundError,
  analyzeDocuments,
  analyzeManualStock,
  analyzeStock,
  fetchLiveTopPicksFromApi,
  fetchMarketLive,
  fetchTopPicks,
  readCachedTopPicks,
} from '../services/apiClient';
import { getBDMarketSession } from '../utils/bdMarketSession';
import { QuotaExceededError } from '../services/quotaService';

export function useMarketLive() {
  const session = getBDMarketSession();
  return useQuery({
    queryKey: ['market-live'],
    queryFn: fetchMarketLive,
    staleTime: 60_000,
    retry: 2,
    retryDelay: 2_500,
    refetchInterval: session.is_live ? 60_000 : false,
  });
}

export function useTopPicks() {
  const session = getBDMarketSession();
  const queryClient = useQueryClient();
  const queryKey = ['top-picks', session.mode] as const;

  const query = useQuery({
    queryKey,
    queryFn: fetchTopPicks,
    initialData: () => readCachedTopPicks() ?? undefined,
    staleTime: session.is_live ? 120_000 : 15 * 60_000,
    retry: 1,
    retryDelay: 1_500,
  });

  // Always refresh live Render picks silently in the background while cards are already visible
  useEffect(() => {
    let active = true;
    void fetchLiveTopPicksFromApi(28_000).then((liveResult) => {
      if (active && liveResult && liveResult.picks.length > 0) {
        queryClient.setQueryData(queryKey, liveResult);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mode]);

  return query;
}

export function useStockAnalysis(symbol: string, exchange: Exchange, enabled = true) {
  const cleanSym = symbol.trim().toUpperCase();
  return useQuery({
    queryKey: ['stock-analysis', exchange, cleanSym],
    queryFn: () => analyzeStock(cleanSym, exchange),
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
