/**
 * Toast notification system — lightweight, no dependencies.
 *
 * Usage:
 *   import { toast } from './Toast';
 *   toast.success('Tab importée !');
 *   toast.error('Erreur réseau');
 *   toast.info('Lien copié');
 *
 * Render <ToastContainer /> once at the app root.
 */

import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
}

let nextId = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

function emit(type: ToastType, text: string) {
  const msg: ToastMessage = { id: nextId++, type, text };
  for (const fn of listeners) fn(msg);
}

export const toast = {
  success: (text: string) => emit('success', text),
  error: (text: string) => emit('error', text),
  info: (text: string) => emit('info', text),
};

const DURATION = 3000;

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'bg-amp-success text-white',
  error: 'bg-amp-error text-white',
  info: 'bg-amp-accent text-amp-bg',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setToasts((prev) => [...prev, msg]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== msg.id));
      }, DURATION);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-slide-in ${TYPE_STYLES[t.type]}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
