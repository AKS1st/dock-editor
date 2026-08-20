/** Show a themed confirm; resolves true on 确定, false on 取消 / Esc / backdrop.
 *  `labels` carries already-translated button text (defaults 'OK' / 'Cancel'). */
export declare function confirmDialog(message: string, labels?: {
    ok?: string;
    cancel?: string;
}): Promise<boolean>;
