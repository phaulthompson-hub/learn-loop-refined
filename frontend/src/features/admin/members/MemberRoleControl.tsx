import { useState, type ReactNode } from 'react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../../app/roles';
import type { Role } from '../../../app/types';
import { Modal } from '../../../components/Modal';
import { cx } from '../../../lib/cx';
import { ROLE_ICONS, RoleBadge } from '../components/bits';
import type { Member } from '../types';

/** Changes that deserve an explicit confirmation: granting ownership or giving up your own. */
export function needsConfirmation(member: Member, role: Role): boolean {
  return role === 'owner' || (member.is_you && member.role === 'owner');
}

export function confirmationCopy(member: Member, role: Role, workspaceName: string): { title: string; message: ReactNode; label: string } {
  if (member.is_you) {
    return {
      title: 'Step down as owner?',
      message: (
        <>
          You will become {role === 'admin' || role === 'instructor' ? 'an' : 'a'} <b>{ROLE_LABELS[role].toLowerCase()}</b> in {workspaceName}. Another owner will
          have to promote you if you want ownership back.
        </>
      ),
      label: 'Step down',
    };
  }
  return {
    title: `Make ${member.name} an owner?`,
    message: (
      <>
        Owners have full control of <b>{workspaceName}</b>: they can change anyone&apos;s role, remove other owners and delete the workspace. You stay an owner
        too.
      </>
    ),
    label: 'Make owner',
  };
}

type Props = { member: Member; options: Role[]; busy: boolean; onChange: (member: Member, role: Role) => void };

/** Inline role select for rows the viewer may edit; a plain badge when the role is locked for them. */
export function MemberRoleControl({ member, options, busy, onChange }: Props) {
  if (!options.length) return <RoleBadge role={member.role} />;
  return (
    <select
      className={cx('input role-select', `role-${member.role}`)}
      value={member.role}
      disabled={busy}
      aria-label={`Role for ${member.name}`}
      onChange={(event) => onChange(member, event.target.value as Role)}
    >
      {[member.role, ...options].map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

/** Role picker dialog opened from a row's menu, with each role's description. */
export function RoleDialog({ member, options, onClose, onPick }: { member: Member; options: Role[]; onClose: () => void; onPick: (role: Role) => void }) {
  const [role, setRole] = useState<Role>(options[0]);
  return (
    <Modal
      title={`Change ${member.is_you ? 'your' : `${member.name}'s`} role`}
      description={
        <>
          Currently <RoleBadge role={member.role} />
        </>
      }
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onPick(role)}>
            Change role
          </button>
        </>
      }
    >
      <fieldset className="role-picker compact">
        <legend className="sr-only">New role</legend>
        {options.map((option) => {
          const Icon = ROLE_ICONS[option];
          return (
            <label key={option} className={cx('role-option', option === role && 'selected')}>
              <input type="radio" name="member-role" value={option} checked={option === role} onChange={() => setRole(option)} />
              <Icon aria-hidden="true" />
              <span>
                <b>{ROLE_LABELS[option]}</b>
                <small>{ROLE_DESCRIPTIONS[option]}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Modal>
  );
}
