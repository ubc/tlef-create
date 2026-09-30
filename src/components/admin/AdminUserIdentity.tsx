import type { AdminUserIdentity as UserIdentity } from '../../services/api';

interface Props {
  user?: UserIdentity | null;
  showEmail?: boolean;
}

const AdminUserIdentity = ({ user, showEmail = true }: Props) => {
  if (!user) return <span>Unknown user</span>;
  return (
    <span className="admin-user-identity">
      <strong>{user.displayName || `Login ID: ${user.cwlId}`}</strong>{' '}
      {showEmail && <small>{user.email || 'Email unavailable'}</small>}{' '}
      {user.displayName && <small>Login ID: {user.cwlId}</small>}{' '}
      {user.cwlUsername && user.cwlUsername !== user.cwlId && <small>CWL: {user.cwlUsername}</small>}{' '}
    </span>
  );
};

export default AdminUserIdentity;
