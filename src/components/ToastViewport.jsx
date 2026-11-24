import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from './ui.jsx';
export function ToastViewport({ toasts, dismiss }) {
  return (
    <div className="fixed right-4 top-4 z-50 space-y-2" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, x: 24, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, x: 0, scale: 1, y: 0 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="flex max-w-sm origin-top-right items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-lift"
          >
            <p className="flex-1 text-sm font-semibold">{toast.message}</p>
            <Button size="sm" variant="ghost" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={15}/></Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
