/** What the booking dialog knows about the booking it opened. */
export type EditableTransaction = {
	id: string;
	categoryId: string | null;
	merchantName: string | null;
	notes: string | null;
	status: "pending" | "booked";
	recurringPaymentId: string | null;
	transferGroupId: string | null;
};

/** What the dialog's form holds when it is saved. */
export type TransactionEditForm = {
	categoryId: string | null;
	merchantName: string | null;
	notes: string | null;
	status: "pending" | "booked";
	recurringPaymentId: string | null;
	createRule: boolean;
};

export type TransactionEditPatch = {
	id: string;
	categoryId?: string | null;
	merchantName?: string | null;
	notes?: string | null;
	status?: "pending" | "booked";
	recurringPaymentId?: string | null;
	createRule?: boolean;
};

/**
 * Only the fields the owner changed. The dialog used to send every field, and
 * the server treats a sent category as the owner's decision: adding a note
 * turned a rule's category into a manual one that rules may never touch again,
 * and on a transfer leg — whose category select is disabled and so missing
 * from the form — it cleared the transfer category altogether.
 */
export function transactionEditPatch(
	original: EditableTransaction,
	form: TransactionEditForm,
): TransactionEditPatch {
	const patch: TransactionEditPatch = { id: original.id };
	const isTransfer = Boolean(original.transferGroupId);
	if (
		!isTransfer &&
		(form.categoryId !== original.categoryId ||
			(form.createRule && form.categoryId))
	)
		patch.categoryId = form.categoryId;
	if (form.merchantName !== (original.merchantName?.trim() || null))
		patch.merchantName = form.merchantName;
	if (form.notes !== (original.notes?.trim() || null)) patch.notes = form.notes;
	if (form.status !== original.status) patch.status = form.status;
	if (form.recurringPaymentId !== original.recurringPaymentId)
		patch.recurringPaymentId = form.recurringPaymentId;
	if (!isTransfer && form.createRule && form.categoryId)
		patch.createRule = true;
	return patch;
}
