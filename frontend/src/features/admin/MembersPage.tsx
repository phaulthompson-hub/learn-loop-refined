import { useMemo, useState } from 'react';
import { MoreHorizontal, Search, ShieldCheck, UserMinus, UserPlus, Users, UserCog } from 'lucide-react';
import { useAuth, useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { ROLE_LABELS, ROLES } from '../../app/roles';
import { useToast } from '../../app/toast';
import type { Role } from '../../app/types';
import { Avatar } from '../../components/Avatar';
import { DataTable, type Column } from '../../components/DataTable';
import { Menu } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { formatDate, formatNumber, plural, relativeTime } from '../../lib/format';
import { matchesQuery } from '../../lib/table';
import { memberApi } from './api';
import { ROLE_ICONS } from './components/bits';
import { InvitationsPanel } from './members/InvitationsPanel';
import { InviteModal } from './members/InviteModal';
import { confirmationCopy, MemberRoleControl, needsConfirmation, RoleDialog } from './members/MemberRoleControl';
import type { Member } from './types';
import { activeOwnerCount, assignableRoles, removalProblem } from './validation';
import './admin.css';

type RoleRequest = { member: Member; role: Role };

export function MembersPage() {
  const workspace = useWorkspace();
  const { refresh } = useAuth();
  const now = useNow();
  const toast = useToast();
  const isAdmin = workspace.can('admin');
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [inviting, setInviting] = useState(false);
  const [pickingFor, setPickingFor] = useState<Member | null>(null);
  const [confirmRole, setConfirmRole] = useState<RoleRequest | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data, error, loading, reload } = useLoader(() => memberApi.list(workspace.id), `members:${workspace.id}:${version}`);

  const members = useMemo(() => data?.items ?? [], [data]);
  const owners = activeOwnerCount(members);
  const rows = useMemo(
    () => members.filter((m) => (!roleFilter || m.role === roleFilter) && matchesQuery(search, m.name, m.email, m.headline)),
    [members, roleFilter, search],
  );
  const optionsFor = (member: Member) => (isAdmin ? assignableRoles(workspace.role, member.role, member.is_you, owners) : []);
  const bump = () => setVersion((v) => v + 1);

  const applyRole = async ({ member, role }: RoleRequest) => {
    setBusyId(member.user_id);
    try {
      await memberApi.changeRole(workspace.id, member.user_id, role);
      toast.success(member.is_you ? `You are now ${ROLE_LABELS[role].toLowerCase()} in ${workspace.name}` : `${member.name} is now ${ROLE_LABELS[role].toLowerCase()}`);
      reload();
      // Your own role (or ownership) changed: the shell's role chip and permissions come from /auth/me.
      if (member.is_you) await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the role');
    } finally {
      setBusyId(null);
    }
  };

  const requestRole = (member: Member, role: Role) => {
    setPickingFor(null);
    if (needsConfirmation(member, role)) setConfirmRole({ member, role });
    else void applyRole({ member, role });
  };

  const remove = async (member: Member) => {
    setBusyId(member.user_id);
    try {
      await memberApi.remove(workspace.id, member.user_id);
      toast.success(`${member.name} was removed from ${workspace.name}`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove this member');
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      sortValue: (m) => m.name,
      render: (m) => (
        <span className={cx('member-cell', !m.is_active && 'inactive')}>
          <Avatar name={m.name} color={m.avatar_color} size="md" />
          <span>
            <b>
              {m.name}
              {m.is_you && <span className="you-tag">You</span>}
              {!m.is_active && <span className="badge">Deactivated</span>}
            </b>
            <small>{m.email}</small>
            {m.headline && <small className="member-headline">{m.headline}</small>}
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (m) => ROLES.indexOf(m.role),
      render: (m) => <MemberRoleControl member={m} options={optionsFor(m)} busy={busyId === m.user_id} onChange={requestRole} />,
    },
    { key: 'joined', header: 'Joined', sortValue: (m) => m.joined_at, className: 'col-optional', render: (m) => formatDate(m.joined_at) },
    {
      key: 'active',
      header: 'Last active',
      sortValue: (m) => m.last_active_at,
      className: 'col-optional',
      render: (m) => (m.last_active_at ? <span title={formatDate(m.last_active_at)}>{relativeTime(m.last_active_at, now)}</span> : <span className="muted">Never</span>),
    },
    { key: 'courses', header: 'Courses', align: 'right', sortValue: (m) => m.courses, className: 'col-optional', render: (m) => formatNumber(m.courses) },
    {
      key: 'answers',
      header: 'Answers · 30d',
      align: 'right',
      sortValue: (m) => m.answers_30d,
      className: 'col-optional',
      render: (m) => <span className={cx('answer-count', m.answers_30d === 0 && 'muted')}>{formatNumber(m.answers_30d)}</span>,
    },
  ];

  if (isAdmin) {
    columns.push({
      key: 'menu',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '52px',
      render: (m) => {
        const options = optionsFor(m);
        const removal = removalProblem(workspace.role, m.role, m.is_you);
        return (
          <Menu
            trigger={({ toggle, ref, open }) => (
              <button type="button" ref={ref} className="icon-only" aria-label={`Actions for ${m.name}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <MoreHorizontal />
              </button>
            )}
            items={[
              { label: 'Change role…', icon: <UserCog />, disabled: !options.length, hint: options.length ? undefined : 'Locked', onSelect: () => setPickingFor(m) },
              'separator',
              { label: 'Remove from workspace', icon: <UserMinus />, danger: true, disabled: !!removal, hint: removal && m.is_you ? 'Use Leave' : undefined, onSelect: () => setRemoving(m) },
            ]}
          />
        );
      },
    });
  }

  const counts = data?.counts;
  const confirmCopy = confirmRole && confirmationCopy(confirmRole.member, confirmRole.role, workspace.name);
  const clearFilters = () => {
    setSearch('');
    setRoleFilter('');
  };
  return (
    <div className="admin-page members-page">
      <PageHeader
        eyebrow={workspace.name}
        title="Members"
        subtitle={data ? `${plural(data.total, 'person', 'people')} in this workspace${isAdmin ? '' : '. Only admins can change roles or invite people.'}` : undefined}
        aside={
          isAdmin && (
            <button type="button" className="primary" onClick={() => setInviting(true)}>
              <UserPlus /> Invite people
            </button>
          )
        }
      />

      {counts && (
        <div className="role-strip" role="group" aria-label="Filter by role">
          {[...ROLES].reverse().map((role) => {
            const Icon = ROLE_ICONS[role];
            const active = roleFilter === role;
            return (
              <button key={role} type="button" className={cx('role-tile', `role-${role}`, active && 'active')} aria-pressed={active} onClick={() => setRoleFilter(active ? '' : role)}>
                <Icon aria-hidden="true" />
                <b>{counts[role]}</b>
                <span>{counts[role] === 1 ? ROLE_LABELS[role] : `${ROLE_LABELS[role]}s`}</span>
              </button>
            );
          })}
        </div>
      )}

      <section className="panel">
        <div className="filter-bar">
          <label className="search-input grow">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Search name, email or headline" aria-label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="input" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | '')}>
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          {(search || roleFilter) && (
            <button type="button" className="ghost small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading label="Loading members…" />
        ) : data && !members.length ? (
          <EmptyState icon={<Users />} title="No members yet" />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(m) => m.user_id}
            initialSort={{ key: 'role', direction: 'desc' }}
            pageSize={15}
            caption="Workspace members"
            rowClassName={(m) => (m.is_you ? 'is-you' : undefined)}
            empty={`No members match${search ? ` “${search}”` : ''}${roleFilter ? ` among ${ROLE_LABELS[roleFilter].toLowerCase()}s` : ''}.`}
          />
        )}
        {isAdmin && owners === 1 && workspace.role === 'owner' && (
          <p className="hint owner-hint">
            <ShieldCheck aria-hidden="true" /> You are the only owner. Make another member an owner before you step down or leave.
          </p>
        )}
      </section>

      {isAdmin && <InvitationsPanel workspaceId={workspace.id} version={version} />}

      {inviting && <InviteModal workspaceId={workspace.id} workspaceName={workspace.name} actorRole={workspace.role} onClose={() => setInviting(false)} onInvited={bump} />}
      {pickingFor && <RoleDialog member={pickingFor} options={optionsFor(pickingFor)} onClose={() => setPickingFor(null)} onPick={(role) => requestRole(pickingFor, role)} />}
      {confirmRole && confirmCopy && (
        <ConfirmDialog
          title={confirmCopy.title}
          message={confirmCopy.message}
          confirmLabel={confirmCopy.label}
          tone="primary"
          onCancel={() => setConfirmRole(null)}
          onConfirm={() => {
            const request = confirmRole;
            setConfirmRole(null);
            void applyRole(request);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          message={
            <>
              {removing.name} will lose access to {workspace.name} straight away. Their quiz history stays, and you can invite them again later.
            </>
          }
          confirmLabel="Remove member"
          busy={busyId === removing.user_id}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </div>
  );
}
