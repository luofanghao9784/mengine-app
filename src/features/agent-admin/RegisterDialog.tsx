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
        <h2 id="agent-register-title">登记实现方案</h2>
        <button type="button" className="button" aria-label="关闭登记面板" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="agent-intro">质量检查 AI 功能实现方案预览，填写内容不会保存。</p>
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          企业功能
          <input value="质量检查" readOnly />
        </label>
        <label>
          模型厂商
          <input placeholder="待填写模型厂商" />
        </label>
        <label>
          运行方式
          <select disabled defaultValue="in-process">
            <option value="in-process">在系统内运行（示意）</option>
          </select>
        </label>
        <label>
          AI 功能标识（可选）
          <input placeholder="待填写 AI 功能标识" />
        </label>
        <label>
          版本（可选）
          <input placeholder="待填写版本" />
        </label>
        <p id="agent-register-note" className="agent-intro">
          AI 功能登记暂不能保存（后台开通中）
        </p>
        <footer className="agent-register-actions">
          <button type="button" className="button" onClick={onClose}>
            返回功能上架
          </button>
          <button
            type="submit"
            className="button"
            disabled
            title="暂时不能保存（后台开通中）"
            aria-describedby="agent-register-note"
          >
            保存登记
          </button>
        </footer>
      </form>
    </dialog>
  );
}
