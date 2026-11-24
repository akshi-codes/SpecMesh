import { Bell, X, Clock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Menu } from "./Interactions.jsx";
import { Button } from "./ui.jsx";
import { useState } from "react";
export function NotificationCenter({
  notifications = [],
  onDismiss,
  onSnooze,
}) {
  const [snoozing, setSnoozing] = useState(false);
  return (
    <Menu
      label={
        notifications.length ? `Alerts (${notifications.length})` : "Alerts"
      }
      icon={<Bell size={16} />}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <strong className="text-sm">Budget alerts</strong>
        <Button
          variant="ghost"
          size="sm"
          disabled={snoozing}
          onClick={async () => {
            setSnoozing(true);
            try {
              await onSnooze?.();
            } finally {
              setSnoozing(false);
            }
          }}
        >
          <Clock size={13} />
          {snoozing ? "Snoozing…" : "Snooze 1h"}
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <AnimatePresence initial={false}>
          {notifications.map((n) => (
            <motion.article
              key={n.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.16 }}
              className="flex items-start gap-2 border-b border-border py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{n.message}</p>
                <time className="mt-1 block text-xs text-mutedForeground">
                  {new Date(n.createdAt).toLocaleString()}
                </time>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Dismiss budget alert"
                onClick={() => onDismiss?.(n.id)}
              >
                <X size={14} />
              </Button>
            </motion.article>
          ))}
        </AnimatePresence>
        {!notifications.length && (
          <p className="py-6 text-sm leading-6 text-mutedForeground">
            No budget alerts. Set a personal budget in Settings to receive
            threshold notifications.
          </p>
        )}
      </div>
    </Menu>
  );
}
