'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Confirmation dialog for admin actions that must record a reason in the audit log. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reason">Reason (recorded in the audit log)</Label>
          <Textarea id="reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={!valid || pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
