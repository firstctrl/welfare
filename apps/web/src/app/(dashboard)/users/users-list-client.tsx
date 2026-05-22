'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Pencil, KeyRound, ToggleLeft, ToggleRight } from 'lucide-react';
import { UserRole, AppModule } from '@welfare/shared';
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserRole,
  resetUserPassword,
  type UserRecord,
  type CreateUserDto,
} from '@/lib/users';
import { usePermission } from '@/hooks/use-permission';
import { useAuthStore } from '@/store/auth.store';
import { Modal } from '@/components/ui/modal';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.WelfareOfficer]:  'Welfare Officer',
  [UserRole.WelfareManager]:  'Welfare Manager',
  [UserRole.WelfareDirector]: 'Welfare Director',
  [UserRole.Admin]:           'Admin',
};

const ROLE_BADGE: Record<UserRole, string> = {
  [UserRole.WelfareOfficer]:  'bg-neutral-100 text-neutral-700',
  [UserRole.WelfareManager]:  'bg-blue-100 text-blue-700',
  [UserRole.WelfareDirector]: 'bg-purple-100 text-purple-700',
  [UserRole.Admin]:           'bg-red-100 text-red-700',
};

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE[role] ?? 'bg-neutral-100 text-neutral-700'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function SourceBadge({ source }: { source: 'ldap' | 'local' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${source === 'ldap' ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-600'}`}>
      {source === 'ldap' ? 'AD' : 'Local'}
    </span>
  );
}

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  currentUserRole: string;
}

function CreateUserModal({ open, onClose, currentUserRole }: CreateModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateUserDto>({
    username: '',
    displayName: '',
    email: '',
    password: '',
    role: UserRole.WelfareOfficer,
  });

  const isAdmin = currentUserRole === UserRole.Admin;

  const roleOptions = [
    { value: UserRole.WelfareOfficer, label: ROLE_LABELS[UserRole.WelfareOfficer] },
    { value: UserRole.WelfareManager, label: ROLE_LABELS[UserRole.WelfareManager] },
    ...(isAdmin ? [
      { value: UserRole.WelfareDirector, label: ROLE_LABELS[UserRole.WelfareDirector] },
      { value: UserRole.Admin, label: ROLE_LABELS[UserRole.Admin] },
    ] : []),
  ];

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created');
      onClose();
      setForm({ username: '', displayName: '', email: '', password: '', role: UserRole.WelfareOfficer });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create user'),
  });

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    mutation.mutate({ ...form, email: form.email || undefined });
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Local User" size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit}>Create</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 mt-1">
        <Field label="Username" required>
          <Input
            value={form.username}
            onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Display Name" required>
          <Input
            value={form.displayName}
            onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
            required
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            autoComplete="off"
          />
        </Field>
        <Field label="Password" required>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="Role" required>
          <Select
            value={form.role}
            onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as UserRole }))}
            options={roleOptions}
          />
        </Field>
      </form>
    </Modal>
  );
}

interface EditRoleModalProps {
  user: UserRecord;
  open: boolean;
  onClose: () => void;
  currentUserRole: string;
}

function EditRoleModal({ user, open, onClose, currentUserRole }: EditRoleModalProps) {
  const qc = useQueryClient();
  const isAdmin = currentUserRole === UserRole.Admin;
  const [role, setRole] = useState<UserRole>(user.role);

  const roleOptions = [
    { value: UserRole.WelfareOfficer, label: ROLE_LABELS[UserRole.WelfareOfficer] },
    { value: UserRole.WelfareManager, label: ROLE_LABELS[UserRole.WelfareManager] },
    ...(isAdmin ? [
      { value: UserRole.WelfareDirector, label: ROLE_LABELS[UserRole.WelfareDirector] },
      { value: UserRole.Admin, label: ROLE_LABELS[UserRole.Admin] },
    ] : []),
  ];

  const mutation = useMutation({
    mutationFn: () => updateUserRole(user._id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Role updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to update role'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit Role" size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>Save</Button>
        </>
      }
    >
      <div className="mt-1 space-y-4">
        <p className="text-sm text-neutral-600">
          Changing role for <span className="font-medium text-neutral-900">{user.displayName}</span>
        </p>
        <Field label="Role" required>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            options={roleOptions}
          />
        </Field>
      </div>
    </Modal>
  );
}

interface ResetPasswordModalProps {
  user: UserRecord;
  open: boolean;
  onClose: () => void;
}

function ResetPasswordModal({ user, open, onClose }: ResetPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user._id, password),
    onSuccess: () => {
      toast.success('Password reset');
      onClose();
      setPassword('');
      setConfirm('');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to reset password'),
  });

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <Modal open={open} onClose={onClose} title="Reset Password" size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!password || mismatch}
            onClick={() => mutation.mutate()}
          >
            Reset
          </Button>
        </>
      }
    >
      <div className="mt-1 space-y-4">
        <p className="text-sm text-neutral-600">
          Reset password for <span className="font-medium text-neutral-900">{user.displayName}</span>
        </p>
        <Field label="New Password" required>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Confirm Password" required error={mismatch ? 'Passwords do not match' : undefined}>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            error={mismatch}
            required
          />
        </Field>
      </div>
    </Modal>
  );
}

interface ToggleActiveModalProps {
  user: UserRecord;
  open: boolean;
  onClose: () => void;
}

function ToggleActiveModal({ user, open, onClose }: ToggleActiveModalProps) {
  const qc = useQueryClient();
  const activate = !user.isActive;

  const mutation = useMutation({
    mutationFn: () => updateUser(user._id, { isActive: activate }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(activate ? 'User activated' : 'User deactivated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to update user'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={activate ? 'Activate User' : 'Deactivate User'}
      size="sm"
      iconKind={activate ? 'success' : 'warning'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={activate ? 'primary' : 'danger'}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {activate ? 'Activate' : 'Deactivate'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-600 mt-1">
        {activate
          ? `Activate ${user.displayName}? They will be able to log in.`
          : `Deactivate ${user.displayName}? They will no longer be able to log in.`}
      </p>
    </Modal>
  );
}

type ActiveModal =
  | { type: 'create' }
  | { type: 'editRole'; user: UserRecord }
  | { type: 'resetPassword'; user: UserRecord }
  | { type: 'toggleActive'; user: UserRecord }
  | null;

export function UsersListClient() {
  const permission = usePermission(AppModule.UserManagement);
  const currentUser = useAuthStore((s) => s.user);
  const currentRole = currentUser?.role ?? '';
  const canManageRoles =
    currentRole === UserRole.Admin || currentRole === UserRole.WelfareManager;

  const [modal, setModal] = useState<ActiveModal>(null);

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  if (error) toast.error('Failed to load users');

  const cols = ['User', 'Username', 'Role', 'Source', 'Status', ''];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {permission === 'full' && (
          <Button variant="primary" Icon={UserPlus} onClick={() => setModal({ type: 'create' })}>
            Add User
          </Button>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                {cols.map((c) => (
                  <th
                    key={c}
                    className="px-4 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
                    style={{ height: 'var(--row-default)' }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr>
                  <td colSpan={cols.length} className="p-0">
                    <TableSkeleton rows={5} cols={cols.length} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={cols.length}>
                    <EmptyState heading="No users found" body="Add the first user to get started." />
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u._id} className="hover:bg-neutral-50 transition-colors duration-fast" style={{ height: 'var(--row-default)' }}>
                    <td className="px-4 text-neutral-900 font-medium">
                      <div className="flex flex-col">
                        <span>{u.displayName}</span>
                        {u.email && <span className="text-xs text-neutral-400">{u.email}</span>}
                      </div>
                    </td>
                    <td className="px-4 text-neutral-600 font-mono text-sm">{u.username}</td>
                    <td className="px-4"><RoleBadge role={u.role} /></td>
                    <td className="px-4"><SourceBadge source={u.source} /></td>
                    <td className="px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4">
                      <div className="flex items-center gap-1 justify-end">
                        {canManageRoles && (
                          <IconButton
                            icon={Pencil}
                            label="Edit role"
                            onClick={() => setModal({ type: 'editRole', user: u })}
                          />
                        )}
                        {canManageRoles && u.source === 'local' && (
                          <IconButton
                            icon={KeyRound}
                            label="Reset password"
                            onClick={() => setModal({ type: 'resetPassword', user: u })}
                          />
                        )}
                        {permission === 'full' && (
                          <IconButton
                            icon={u.isActive ? ToggleRight : ToggleLeft}
                            label={u.isActive ? 'Deactivate' : 'Activate'}
                            onClick={() => setModal({ type: 'toggleActive', user: u })}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateUserModal
        open={modal?.type === 'create'}
        onClose={() => setModal(null)}
        currentUserRole={currentRole}
      />

      {modal?.type === 'editRole' && (
        <EditRoleModal
          user={modal.user}
          open
          onClose={() => setModal(null)}
          currentUserRole={currentRole}
        />
      )}

      {modal?.type === 'resetPassword' && (
        <ResetPasswordModal
          user={modal.user}
          open
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'toggleActive' && (
        <ToggleActiveModal
          user={modal.user}
          open
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
