import { useEffect, useRef } from 'react';

// Date and time boxes that Safari's Reset/Clear button works with.
// React normally keeps an input's *default* value equal to what's typed, so on an iPhone or
// iPad "Reset" puts back the same date and looks broken, and Safari often doesn't announce the
// change at all. This keeps the default empty (Reset clears it) and listens to the box directly,
// so every way of changing it — typing, the picker, Reset, Clear — reaches the form.
// Use it like <input type="date">: value and onChange(e) with e.target.value.
export function DateInput({ value, onChange, type = 'date', ...rest }) {
  const ref = useRef(null);
  const last = useRef(value || '');
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    const el = ref.current;
    last.current = value || '';
    if (el && el.value !== last.current) el.value = last.current;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const report = () => {
      if (el.value === last.current) return;
      last.current = el.value;
      handler.current?.({ target: el, currentTarget: el });
    };
    const kinds = ['input', 'change', 'blur'];
    kinds.forEach((k) => el.addEventListener(k, report));
    return () => kinds.forEach((k) => el.removeEventListener(k, report));
  }, []);
  return <input ref={ref} type={type} defaultValue="" {...rest} />;
}
