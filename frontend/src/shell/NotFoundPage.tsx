import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <EmptyState icon={<Compass />} title={`This ${what} does not exist`}>
      <p>It may have been deleted, or the link is incorrect.</p>
      <Link className="primary" to="/">
        Back to dashboard
      </Link>
    </EmptyState>
  );
}
