import { useEffect, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { OhlcvPoint } from '../../types/market';
import { computeProChartIndicators } from '../../utils/quantConsensus';

export interface TerminalIndicatorToggles {
  sma: boolean;
  ema: boolean;
  bb: boolean;
  vol: boolean;
  rsi: boolean;
}

export function TradingViewTerminal({
  ohlcv,
  toggles,
  resetSignal,
}: {
  ohlcv: OhlcvPoint[];
  toggles: TerminalIndicatorToggles;
  resetSignal: number;
}) {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const rsiRef = useRef<HTMLDivElement | null>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candles?: ISeriesApi<'Candlestick'>;
    volume?: ISeriesApi<'Histogram'>;
    sma?: ISeriesApi<'Line'>;
    ema?: ISeriesApi<'Line'>;
    bbUpper?: ISeriesApi<'Line'>;
    bbLower?: ISeriesApi<'Line'>;
    rsi?: ISeriesApi<'Line'>;
  }>({});

  // Initialize charts once & attach ResizeObserver for clean teardown
  useEffect(() => {
    const mainEl = mainRef.current;
    const rsiEl = rsiRef.current;
    if (!mainEl || !rsiEl) return;

    const mainChart = createChart(mainEl, {
      width: mainEl.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#FFFFFF' },
        textColor: '#334155',
        fontFamily: 'IBM Plex Mono, monospace',
      },
      grid: {
        vertLines: { color: '#F1F5F9' },
        horzLines: { color: '#F1F5F9' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#CBD5E1' },
      timeScale: { borderColor: '#CBD5E1', timeVisible: true },
    });

    const candles = mainChart.addCandlestickSeries({
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderUpColor: '#16A34A',
      borderDownColor: '#DC2626',
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    });

    const volume = mainChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    mainChart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const sma = mainChart.addLineSeries({ color: '#D97706', lineWidth: 2, title: 'SMA 20' });
    const ema = mainChart.addLineSeries({ color: '#0284C7', lineWidth: 2, title: 'EMA 20' });
    const bbUpper = mainChart.addLineSeries({
      color: 'rgba(126, 34, 206, 0.65)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Upper',
    });
    const bbLower = mainChart.addLineSeries({
      color: 'rgba(126, 34, 206, 0.65)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Lower',
    });

    const rsiChart = createChart(rsiEl, {
      width: rsiEl.clientWidth,
      height: 150,
      layout: {
        background: { type: ColorType.Solid, color: '#FFFFFF' },
        textColor: '#334155',
        fontFamily: 'IBM Plex Mono, monospace',
      },
      grid: {
        vertLines: { color: '#F1F5F9' },
        horzLines: { color: '#F1F5F9' },
      },
      rightPriceScale: { borderColor: '#CBD5E1' },
      timeScale: { visible: false },
    });

    const rsi = rsiChart.addLineSeries({ color: '#16A34A', lineWidth: 2, title: 'RSI (14)' });
    rsi.createPriceLine({ price: 70, color: '#DC2626', lineWidth: 1, lineStyle: 2, title: '70 Overbought' });
    rsi.createPriceLine({ price: 30, color: '#1D4ED8', lineWidth: 1, lineStyle: 2, title: '30 Oversold' });

    const handleRangeSync = (range: ReturnType<ReturnType<IChartApi['timeScale']>['getVisibleLogicalRange']>) => {
      if (range) {
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
    };
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeSync);

    const resizeObserver = new ResizeObserver(() => {
      if (mainEl.clientWidth > 0) {
        mainChart.applyOptions({ width: mainEl.clientWidth });
      }
      if (rsiEl.clientWidth > 0) {
        rsiChart.applyOptions({ width: rsiEl.clientWidth });
      }
    });
    resizeObserver.observe(mainEl);
    resizeObserver.observe(rsiEl);

    mainChartRef.current = mainChart;
    rsiChartRef.current = rsiChart;
    seriesRef.current = { candles, volume, sma, ema, bbUpper, bbLower, rsi };

    return () => {
      resizeObserver.disconnect();
      mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeSync);
      mainChart.remove();
      rsiChart.remove();
      mainChartRef.current = null;
      rsiChartRef.current = null;
      seriesRef.current = {};
    };
  }, []);

  // Push OHLCV and genuinely calculated 20-period & 14-period indicators into chart series
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candles || !ohlcv.length) return;

    // Deduplicate and sort strictly ascending by date for lightweight-charts
    const byDate = new Map<string, OhlcvPoint>();
    for (const pt of ohlcv) {
      byDate.set(pt.date, pt);
    }
    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    const candleData = sorted.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const volumeData = sorted.map((d) => ({
      time: d.date as Time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(22, 163, 74, 0.35)' : 'rgba(220, 38, 38, 0.35)',
    }));

    const inds = computeProChartIndicators(sorted);

    s.candles.setData(candleData);
    s.volume?.setData(volumeData);
    s.sma?.setData(inds.sma20.map((p) => ({ time: p.time as Time, value: p.value })));
    s.ema?.setData(inds.ema20.map((p) => ({ time: p.time as Time, value: p.value })));
    s.bbUpper?.setData(inds.bbUpper.map((p) => ({ time: p.time as Time, value: p.value })));
    s.bbLower?.setData(inds.bbLower.map((p) => ({ time: p.time as Time, value: p.value })));
    s.rsi?.setData(inds.rsi14.map((p) => ({ time: p.time as Time, value: p.value })));

    mainChartRef.current?.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();
  }, [ohlcv]);

  // Toggle visibility without destroying series
  useEffect(() => {
    const s = seriesRef.current;
    s.sma?.applyOptions({ visible: toggles.sma });
    s.ema?.applyOptions({ visible: toggles.ema });
    s.bbUpper?.applyOptions({ visible: toggles.bb });
    s.bbLower?.applyOptions({ visible: toggles.bb });
    s.volume?.applyOptions({ visible: toggles.vol });
  }, [toggles]);

  // Reset zoom on explicit user click
  useEffect(() => {
    if (resetSignal > 0) {
      mainChartRef.current?.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
    }
  }, [resetSignal]);

  return (
    <div className="space-y-3">
      <div
        ref={mainRef}
        className="w-full h-[420px] rounded-xl overflow-hidden border border-slate-200 bg-white"
      />
      <div className={toggles.rsi ? 'block pt-1' : 'hidden'}>
        <div className="text-xs font-semibold text-slate-600 mb-1.5 px-1">
          RSI (14) Momentum Oscillator · 70 Overbought / 30 Oversold
        </div>
        <div
          ref={rsiRef}
          className="w-full h-[150px] rounded-xl overflow-hidden border border-slate-200 bg-white"
        />
      </div>
    </div>
  );
}
