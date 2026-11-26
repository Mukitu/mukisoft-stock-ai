import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { OhlcvPoint } from '../../types/market';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, Legend);

export function PriceMovementChart({
  symbol,
  history,
}: {
  symbol: string;
  history: OhlcvPoint[];
}) {
  if (!history.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-500">
        চার্ট ডেটা পাওয়া যায়নি।
      </div>
    );
  }

  const data = {
    labels: history.map((d) => d.date),
    datasets: [
      {
        label: `${symbol} Close (BDT)`,
        data: history.map((d) => d.close),
        borderColor: '#1D4ED8',
        backgroundColor: 'rgba(29, 78, 216, 0.08)',
        borderWidth: 2,
        pointRadius: history.length <= 8 ? 3 : 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.25,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ৳ ${Number(ctx.parsed.y).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: '#F1F5F9' },
        ticks: { color: '#64748B', maxTicksLimit: 8, font: { size: 11 } },
      },
      y: {
        grid: { color: '#F1F5F9' },
        ticks: {
          color: '#64748B',
          font: { size: 11 },
          callback: (val) => `৳${val}`,
        },
      },
    },
  };

  return (
    <div className="h-72 w-full">
      <Line data={data} options={options} />
    </div>
  );
}
