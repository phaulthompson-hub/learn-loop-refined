import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../app/auth';
import { EmptyState } from '../components/ui';

/** Shown to a signed-in user who is not a member of any workspace (e.g. after being removed from one). */
export function NoWorkspacePage() {
  const { logout } = useAuth();
  return (
    <div className="centered-page">
      <EmptyState icon={<Building2 />} title="You are not in a workspace yet">
        <p>Ask a workspace admin to invite you, or open an invitation link from your email.</p>
        <div className="actions center">
          <Link className="primary" to="/workspaces/new">
            Create a workspace
          </Link>
          <button type="button" className="secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </EmptyState>
    </div>
  );
}
