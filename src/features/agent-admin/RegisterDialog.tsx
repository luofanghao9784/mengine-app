import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function RegisterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="agent-register"
      aria-labelledby="agent-register-title"
      aria-describedby="agent-register-note"
      onClose={onClose}
    >
      <header className="agent-register-header">
        <h2 id="agent-register-title">登记实现</h2>
        <button type="button" className="button" aria-label="关闭登记面板" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="agent-intro">质量检查登记种子 · 表单骨架，填写内容不会保存。</p>
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          企业端功能（enterpriseFunction）
          <input value="quality-check" readOnly />
        </label>
        <label>
          模型厂商（modelVendor）
          <input placeholder="待填写模型厂商" />
        </label>
        <label>
          运行方式（runtimeKind）
          <select disabled defaultValue="in-process">
            <option value="in-process">in-process（示意）</option>
          </select>
        </label>
        <label>
          能力标识（capabilityKey，可选）
          <input placeholder="待填写能力标识" />
        </label>
        <label>
          版本（version，可选）
          <input placeholder="待填写版本" />
        </label>
        <p id="agent-register-note" className="agent-intro">
          写 API 未就绪（CT-018）
        </p>
        <footer className="agent-register-actions">
          <button type="button" className="button" onClick={onClose}>
            返回目录
          </button>
          <button type="submit" className="button primary" disabled aria-describedby="agent-register-note">
            提交登记
          </button>
        </footer>
      </form>
    </dialog>
  );
}
