// src/components/NotificationSystem.tsx
import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS, NotificationPayload } from '../services/pubsubService';
import '../styles/components/NotificationSystem.css';

interface Notification extends NotificationPayload {
    timestamp: number;
    timeoutId?: NodeJS.Timeout;
}

// Timer Bar Component
const TimerBar: React.FC<{ duration: number; onComplete: () => void }> = ({ duration, onComplete }) => {
    const [timeLeft, setTimeLeft] = useState(duration);
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        if (isPaused) return;

        const interval = setInterval(() => {
            setTimeLeft(prev => {
                const newTime = prev - 100;
                if (newTime <= 0) {
                    clearInterval(interval);
                    onComplete();
                    return 0;
                }
                return newTime;
            });
        }, 100);

        return () => clearInterval(interval);
    }, [onComplete, isPaused]);

    const percentage = (timeLeft / duration) * 100;

    return (
        <div 
            className="notification-timer"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            style={{ backgroundColor: 'red' }} // Temporary debug color
        >
            <div 
                className="notification-timer-bar" 
                style={{ width: `${percentage}%`, backgroundColor: 'blue' }} // Temporary debug color
            />
        </div>
    );
};

const NotificationSystem: React.FC = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const { subscribe } = usePubSub('NotificationSystem');

    useEffect(() => {
        const showToken = subscribe<NotificationPayload>(
            PUBSUB_EVENTS.SHOW_NOTIFICATION,
            (data) => {
                let timeoutId: NodeJS.Timeout | undefined;

                const notification: Notification = {
                    ...data,
                    timestamp: Date.now(),
                    timeoutId,
                };

                // Check for duplicates before adding
                setNotifications(prev => {
                    const exists = prev.some(n => n.id === notification.id);
                    if (exists) {
                        return prev; // Don't add duplicate
                    }
                    return [...prev, notification];
                });

                // Auto remove after duration
                if (data.duration) {
                    timeoutId = setTimeout(() => {
                        removeNotification(data.id);
                    }, data.duration);
                    
                    // Update the notification with the timeout ID
                    setNotifications(prev => 
                        prev.map(n => 
                            n.id === data.id ? { ...n, timeoutId } : n
                        )
                    );
                }
            }
        );

        const hideToken = subscribe<{ id: string }>(
            PUBSUB_EVENTS.HIDE_NOTIFICATION,
            (data) => {
                removeNotification(data.id);
            }
        );

        return () => {
            // Cleanup handled by usePubSub hook
        };
    }, [subscribe]);

    const removeNotification = (id: string) => {
        setNotifications(prev => {
            const notification = prev.find(n => n.id === id);
            if (notification?.timeoutId) {
                clearTimeout(notification.timeoutId);
            }
            return prev.filter(n => n.id !== id);
        });
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success':
                return <CheckCircle size={20} className="notification-icon-success" />;
            case 'error':
                return <AlertCircle size={20} className="notification-icon-error" />;
            case 'warning':
                return <AlertTriangle size={20} className="notification-icon-warning" />;
            case 'info':
                return <Info size={20} className="notification-icon-info" />;
            default:
                return <Info size={20} className="notification-icon-default" />;
        }
    };

    const getTypeClass = (type: string) => {
        switch (type) {
            case 'success':
                return 'notification-success';
            case 'error':
                return 'notification-error';
            case 'warning':
                return 'notification-warning';
            case 'info':
                return 'notification-info';
            default:
                return 'notification-default';
        }
    };

    if (notifications.length === 0) return null;

    return (
        <div className="notification-container">
            {notifications.map((notification) => (
                <div
                    key={notification.id}
                    className={`notification-item ${getTypeClass(notification.type)}`}
                >
                    <div className="notification-main">
                        <div className="notification-content">
                            <div className="notification-icon">
                                {getIcon(notification.type)}
                            </div>
                            <div className="notification-text">
                                <div className="notification-title">{notification.title}</div>
                                <div className="notification-message">{notification.message}</div>
                            </div>
                        </div>
                        <button
                            className="notification-close"
                            onClick={() => removeNotification(notification.id)}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {notification.duration && (
                        <>
                            <TimerBar
                                duration={notification.duration} 
                                onComplete={() => removeNotification(notification.id)}
                            />
                        </>
                    )}
                </div>
            ))}
        </div>
    );
};

export default NotificationSystem;