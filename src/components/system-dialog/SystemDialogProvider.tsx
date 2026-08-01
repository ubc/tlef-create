import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { ReactNode } from 'react';
import { CircleCheck, Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import '../../styles/components/SystemDialog.css';

export type SystemDialogTone = 'info' | 'success' | 'warning' | 'danger';

export interface SystemDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: SystemDialogTone;
}

interface DialogRequest extends Required<Pick<SystemDialogOptions, 'title' | 'description'>> {
  id: number;
  mode: 'alert' | 'confirm';
  confirmLabel: string;
  cancelLabel: string;
  tone: SystemDialogTone;
  resolve: (accepted: boolean) => void;
}

interface SystemDialogContextValue {
  showAlert: (options: SystemDialogOptions) => Promise<void>;
  showConfirm: (options: SystemDialogOptions) => Promise<boolean>;
}

const missingProvider = async () => {
  throw new Error('SystemDialogProvider is required before opening a system dialog.');
};

const SystemDialogContext = createContext<SystemDialogContextValue>({
  showAlert: missingProvider,
  showConfirm: missingProvider
});

const TONE_ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: ShieldAlert
};

export function SystemDialogProvider({ children }: { children: ReactNode }) {
  const [currentDialog, setCurrentDialog] = useState<DialogRequest | null>(null);
  const currentDialogRef = useRef<DialogRequest | null>(null);
  const queuedDialogsRef = useRef<DialogRequest[]>([]);
  const requestIdRef = useRef(0);

  const enqueue = useCallback((request: DialogRequest) => {
    if (currentDialogRef.current) {
      queuedDialogsRef.current.push(request);
      return;
    }

    currentDialogRef.current = request;
    setCurrentDialog(request);
  }, []);

  const finishCurrent = useCallback((accepted: boolean) => {
    const finished = currentDialogRef.current;
    if (!finished) return;

    currentDialogRef.current = null;
    finished.resolve(accepted);

    const next = queuedDialogsRef.current.shift() || null;
    currentDialogRef.current = next;
    setCurrentDialog(next);
  }, []);

  const showConfirm = useCallback((options: SystemDialogOptions) => (
    new Promise<boolean>(resolve => {
      enqueue({
        id: ++requestIdRef.current,
        mode: 'confirm',
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel || 'Continue',
        cancelLabel: options.cancelLabel || 'Cancel',
        tone: options.tone || 'warning',
        resolve
      });
    })
  ), [enqueue]);

  const showAlert = useCallback(async (options: SystemDialogOptions) => {
    await new Promise<boolean>(resolve => {
      enqueue({
        id: ++requestIdRef.current,
        mode: 'alert',
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: '',
        tone: options.tone || 'info',
        resolve
      });
    });
  }, [enqueue]);

  useEffect(() => {
    const nativeAlert = window.alert;

    // Some embedded H5P editors still call the browser API directly. Route
    // those notices through CREATE's accessible dialog without patching the
    // vendored runtime files.
    window.alert = message => {
      void showAlert({
        title: 'Notice',
        description: String(message),
        tone: 'info'
      });
    };

    return () => {
      window.alert = nativeAlert;
    };
  }, [showAlert]);

  useEffect(() => () => {
    currentDialogRef.current?.resolve(false);
    queuedDialogsRef.current.forEach(dialog => dialog.resolve(false));
    currentDialogRef.current = null;
    queuedDialogsRef.current = [];
  }, []);

  const contextValue = useMemo(() => ({ showAlert, showConfirm }), [showAlert, showConfirm]);
  const Icon = currentDialog ? TONE_ICONS[currentDialog.tone] : Info;

  return (
    <SystemDialogContext.Provider value={contextValue}>
      {children}
      {currentDialog && (
        <Dialog
          key={currentDialog.id}
          open
          onOpenChange={open => {
            if (!open) finishCurrent(false);
          }}
        >
          <DialogContent
            role="alertdialog"
            className={`system-dialog system-dialog-${currentDialog.tone}`}
          >
            <div className="system-dialog-heading">
              <span className="system-dialog-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <DialogHeader>
                <DialogTitle>{currentDialog.title}</DialogTitle>
                <DialogDescription>{currentDialog.description}</DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter>
              {currentDialog.mode === 'confirm' && (
                <button
                  type="button"
                  className="btn btn-outline system-dialog-button"
                  onClick={() => finishCurrent(false)}
                >
                  {currentDialog.cancelLabel}
                </button>
              )}
              <button
                type="button"
                className={`btn system-dialog-button ${currentDialog.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => finishCurrent(true)}
                autoFocus
              >
                {currentDialog.confirmLabel}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SystemDialogContext.Provider>
  );
}

// The provider and its hook intentionally share one module so consumers cannot
// accidentally import a context that differs from the mounted provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useSystemDialog() {
  return useContext(SystemDialogContext);
}
