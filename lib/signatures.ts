export const SIGNATURE_COLORS = ["#bb6688", "#8066bb", "#5c8fa3", "#668c76", "#c28b55", "#b85f67"] as const;
export type Point = [number, number];
export type SignatureInput = { requestId: string; name: string; message: string; color: string; strokes: Point[][] };

export function validateSignature(value: unknown): SignatureInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请填写有效的签名信息。");
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.requestId)) throw new Error("提交编号无效，请刷新后重试。");
  const clean = (input: unknown, limit: number, label: string) => {
    if (typeof input !== "string") throw new Error(`请填写${label}。`);
    const result = input.trim();
    if (!result || [...result].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error(`${label}需填写1至${limit}个字。`);
    return result;
  };
  const name = clean(v.name, 24, "名字");
  const message = clean(v.message, 400, "祝福");
  if (typeof v.color !== "string" || !(SIGNATURE_COLORS as readonly string[]).includes(v.color)) throw new Error("请选择提供的签名颜色。");
  const strokes = v.strokes ?? [];
  if (!Array.isArray(strokes) || strokes.length > 32) throw new Error("手写签名最多支持32笔。");
  let total = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length || (total += stroke.length) > 2400) throw new Error("手写签名过于复杂，请清空后重写。");
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) throw new Error("手写签名格式无效，请清空后重写。");
    }
  }
  return { requestId: v.requestId.toLowerCase(), name, message, color: v.color, strokes: strokes as Point[][] };
}
