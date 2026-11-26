import { useState, type FormEvent } from 'react';
import { ExternalLink, User } from 'lucide-react';
import { submitContactMessage } from '../services/apiClient';

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await submitContactMessage({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      });
      setStatus({ type: 'success', text: res.message });
      setName('');
      setEmail('');
      setMessage('');
    } catch {
      setStatus({
        type: 'error',
        text: 'বার্তা পাঠানো সম্ভব হয়নি। অনুগ্রহ করে সরাসরি contact@mukisoft.tech-এ ইমেইল করুন।',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1 grid md:grid-cols-12 gap-8 items-start">
      <div className="md:col-span-5 bg-white border border-slate-200 p-7 rounded-2xl space-y-5">
        <div className="flex items-center gap-4">
          {!imgFailed ? (
            <img
              src="/assets/founder.png"
              alt="মুকিতু ইসলাম নিশাত (Mukitu Islam Nishat)"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
              <User className="w-6 h-6" />
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-blue-700">Founder &amp; Director</div>
            <h2 className="text-lg font-bold text-slate-900">মুকিতু ইসলাম নিশাত</h2>
            <p className="text-xs text-slate-500">Mukitu Islam Nishat</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-4">
          <strong className="text-slate-900">MukiSoft Technology</strong>-এর প্রতিষ্ঠাতা ও পরিচালক। সফটওয়্যার
          ইঞ্জিনিয়ারিং এবং আর্টিফিশিয়াল ইন্টেলিজেন্স গবেষণার মাধ্যমে বাংলাদেশের পুঁজিবাজার বিশ্লেষণের জন্য এই প্ল্যাটফর্ম নির্মাণ করেছেন।
        </p>

        <div className="space-y-2.5 text-xs text-slate-700 border-t border-slate-100 pt-4">
          <div>
            <strong className="text-slate-900">প্রতিষ্ঠান:</strong> MukiSoft Technology
          </div>
          <div>
            <strong className="text-slate-900">ইমেইল:</strong> contact@mukisoft.tech
          </div>
          <div className="flex items-center gap-1">
            <strong className="text-slate-900">ওয়েবসাইট:</strong>
            <a
              href="https://mukisoft.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            >
              <span>mukisoft.tech</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div>
            <strong className="text-slate-900">অবস্থান:</strong> রাজশাহী, বাংলাদেশ
          </div>
        </div>
      </div>

      <div className="md:col-span-7 bg-white border border-slate-200 p-8 rounded-2xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">সরাসরি বার্তা পাঠান</h1>
        <p className="text-slate-500 text-sm mb-6">
          যেকোনো প্রশ্ন, কর্পোরেট সাবস্ক্রিপশন বা টেকনিক্যাল সহযোগিতার জন্য নিচের ফর্মটি পূরণ করুন।
        </p>

        {status && (
          <div
            className={`mb-5 p-4 rounded-xl text-sm font-medium border ${
              status.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {status.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="c-name" className="block text-xs font-semibold text-slate-600 mb-1">
              আপনার নাম
            </label>
            <input
              id="c-name"
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="পূর্ণ নাম লিখুন"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-700 focus:bg-white"
            />
          </div>
          <div>
            <label htmlFor="c-email" className="block text-xs font-semibold text-slate-600 mb-1">
              ইমেইল ঠিকানা
            </label>
            <input
              id="c-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-700 focus:bg-white"
            />
          </div>
          <div>
            <label htmlFor="c-message" className="block text-xs font-semibold text-slate-600 mb-1">
              আপনার বার্তা
            </label>
            <textarea
              id="c-message"
              rows={4}
              required
              minLength={10}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="বিস্তারিত লিখুন..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-700 focus:bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-xl transition-colors cursor-pointer"
          >
            {submitting ? 'পাঠানো হচ্ছে...' : 'বার্তা পাঠান'}
          </button>
        </form>
      </div>
    </main>
  );
}
