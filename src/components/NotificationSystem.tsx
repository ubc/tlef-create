// src/components/NotificationSystem.tsx
import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS, NotificationPayload } from '../services/pubsubService';
import '../styles/components/NotificationSystem.css';

interface Notification extends NotificationPayload {
    timestamp: number;
}

const NotificationSystem: React.FC = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const { subscribe } = usePubSub('NotificationSystem');

    useEffect(() => {
        const showToken = subscribe<NotificationPayload>(
            PUBSUB_EVENTS.SHOW_NOTIFICATION,
            (data) => {
                const notification: Notification = {
                    ...data,
                    timestamp: Date.now(),
                };

                // Check for duplicates before adding
                setNotifications(prev => {
                    const exists = prev.some(n => n.id === notification.id);
                    if (exists) {
                        console.warn('Duplicate notification ID detected:', notification.id);
                        return prev; // Don't add duplicate
                    }
                    return [...prev, notification];
                });

                // Auto remove after duration
                if (data.duration) {
                    setTimeout(() => {
                        removeNotification(data.id);
                    }, data.duration);
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
        setNotifications(prev => prev.filter(n => n.id !== id));
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
            ))}
        </div>
    );
};

export default NotificationSystem;