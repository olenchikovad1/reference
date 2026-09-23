// Рендерер изделия с принтом: один проход WebGL2.
//
// Своё, а не PixiJS: нужен ровно один шейдер, и зависимость ради него стоила бы
// дороже, чем полторы сотни строк. Вторая причина важнее — этот же GLSL потом
// пойдёт headless на сервер, чтобы миниатюры и экспорт совпадали с браузером
// пиксель в пиксель, а тащить туда браузерную библиотеку не хочется.
//
// Разделение труда: карта яркости считается один раз на кадр изделия (оно не
// меняется, пока двигают принт), а при каждом движении обновляется только
// текстура принта.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uGarment;   // кадр изделия, RGBA
uniform sampler2D uPrint;     // композиция принта, RGBA
uniform sampler2D uBlur;      // размытая яркость: её градиент двигает принт
uniform sampler2D uLum;       // яркость как есть: ею затеняется принт
uniform sampler2D uOccluder;  // что лежит ПОВЕРХ принта: капюшон

uniform vec2  uTexel;         // размер пикселя карты, для градиента
uniform float uDisplace;      // сила смещения
uniform float uShade;         // сила затенения принта
uniform float uShadeGamma;    // гамма затенения
uniform float uWhite;         // опорный белый изделия, 0..1
uniform float uEffects;       // 1 — с эффектами, 0 — плоско
uniform vec3  uBase;          // цвет изделия
uniform float uBaseGamma;     // гамма перекраски
uniform float uSpecCut;       // порог, выше которого начинаются блики
uniform float uSpecAmount;    // сила бликов
uniform float uThrough;       // 1 — показывать перекрытое насквозь

void main() {
  vec4 garment = texture(uGarment, vUv);

  // Перекраска. Чистое умножение на цвет здесь не годится: опорный белый кадра
  // 245, глубокая тень 56, и на чёрном (#1a1a1a) остался бы диапазон 26…6 —
  // плоское пятно вместо изделия. А чёрный самый ходовой цвет, и опозорилось бы
  // это на первом же показе.
  //
  // Поэтому гамма поднимает средние тона, а блики возвращают объём: то, что
  // ярче порога, добавляется поверх цвета, а не умножается на него.
  float l = clamp(garment.r / max(uWhite, 0.001), 0.0, 1.0);
  vec3 tinted = uBase * pow(l, uBaseGamma);
  float spec = max(0.0, l - uSpecCut) / max(1e-3, 1.0 - uSpecCut);
  tinted += vec3(spec * spec * uSpecAmount);
  garment.rgb = clamp(tinted, 0.0, 1.0);

  // Градиент размытой яркости. Складка — это и есть перепад яркости, поэтому
  // её же градиент и тянет рисунок: физически неверно, на ткани убедительно.
  float lx = texture(uBlur, vUv + vec2(uTexel.x, 0.0)).r
           - texture(uBlur, vUv - vec2(uTexel.x, 0.0)).r;
  float ly = texture(uBlur, vUv + vec2(0.0, uTexel.y)).r
           - texture(uBlur, vUv - vec2(0.0, uTexel.y)).r;
  vec2 disp = vec2(lx, ly) * uDisplace * uEffects;

  vec4 print = texture(uPrint, vUv + disp);

  // Затенение по неразмытой яркости, нормированной на опорный белый изделия.
  // Делить на единицу нельзя: белое у кадра равно 245/255, и принт вышел бы
  // систематически темнее изделия, на котором лежит.
  float lum = texture(uLum, vUv).r;
  float shade = pow(clamp(lum / max(uWhite, 0.001), 0.0, 1.0), uShadeGamma);
  print.rgb *= mix(1.0, shade, uShade * uEffects);

  // Перекрытие. Капюшон лежит ПОВЕРХ верха спины, и принт, нарисованный
  // сверху, показывает то, чего не бывает. Врать здесь дороже всего: «а
  // капюшон это не закроет?» — тот самый вопрос, ради которого всё затевается.
  //
  // Насквозь показывать можно, но по явному выбору смотрящего: в работе
  // полезно знать, что там нарисовано, а по умолчанию картинка обязана
  // соответствовать жизни.
  float occluded = texture(uOccluder, vUv).r;
  float hidden = occluded * (1.0 - uThrough);

  // Принт живёт только на изделии: за силуэтом его нет.
  float a = print.a * step(0.5, garment.a) * (1.0 - hidden) * mix(1.0, 0.45, occluded * uThrough);
  outColor = vec4(mix(garment.rgb, print.rgb, a), garment.a);
}`

export interface RenderParams {
  /** Цвет изделия, 0..1 по каналу. */
  base: [number, number, number]
  baseGamma: number
  specCut: number
  specAmount: number
  /** Показывать ли перекрытое капюшоном насквозь. */
  through: boolean
  displace: number
  shade: number
  shadeGamma: number
  effects: boolean
}

export const DEFAULT_PARAMS: RenderParams = {
  // Значения предварительные ровно в том же смысле, что и калибровка, и
  // подлежат подбору ползунками.
  //
  // Порядок величины важен: градиент размытой яркости здесь около 0.01, а у
  // складок до 0.03. Чтобы сдвиг был виден глазом (десяток пикселей на кадре
  // в 1440), множитель обязан быть порядка единицы, а не сотых. Первая версия
  // с 0.012 давала сдвиг в полпикселя — эффект был, но увидеть его было нельзя.
  base: [1, 1, 1],
  // Гамма ниже единицы поднимает средние тона: без неё тёмная база
  // теряет складки, а с ними и всякое правдоподобие.
  baseGamma: 0.8,
  specCut: 0.88,
  specAmount: 0.35,
  through: false,
  displace: 0.25,
  shade: 0.85,
  shadeGamma: 1.0,
  effects: true,
}

export interface Renderer {
  setGarment(image: TexImageSource, blur: Uint8ClampedArray, lum: Uint8ClampedArray, w: number, h: number, white: number): void
  setPrint(source: TexImageSource): void
  /** Что лежит поверх принта на этом состоянии. */
  setOccluder(source: TexImageSource): void
  setParams(p: RenderParams): void
  draw(): void
  dispose(): void
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false })
  if (!gl) return null

  const program = link(gl, VERT, FRAG)
  if (!program) return null
  gl.useProgram(program)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const tex = {
    garment: makeTexture(gl),
    print: makeTexture(gl),
    occluder: makeTexture(gl),
    blur: makeTexture(gl),
    lum: makeTexture(gl),
  }
  const u = (name: string) => gl.getUniformLocation(program, name)
  let params = DEFAULT_PARAMS
  let mapSize: [number, number] = [1, 1]
  let white = 1

  bindUnit(gl, program, 'uGarment', 0)
  bindUnit(gl, program, 'uPrint', 1)
  bindUnit(gl, program, 'uBlur', 2)
  bindUnit(gl, program, 'uLum', 3)
  bindUnit(gl, program, 'uOccluder', 4)

  return {
    setGarment(image, blur, lum, w, h, whitePoint) {
      mapSize = [w, h]
      white = whitePoint / 255
      upload(gl, tex.garment, 0, image)
      uploadGray(gl, tex.blur, 2, blur, w, h)
      uploadGray(gl, tex.lum, 3, lum, w, h)
    },
    setPrint(source) {
      upload(gl, tex.print, 1, source)
    },
    setOccluder(source) {
      upload(gl, tex.occluder, 4, source)
    },
    setParams(p) {
      params = p
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(program)
      gl.uniform2f(u('uTexel'), 1 / mapSize[0], 1 / mapSize[1])
      gl.uniform1f(u('uDisplace'), params.displace)
      gl.uniform1f(u('uShade'), params.shade)
      gl.uniform1f(u('uShadeGamma'), params.shadeGamma)
      gl.uniform1f(u('uWhite'), white)
      gl.uniform1f(u('uEffects'), params.effects ? 1 : 0)
      gl.uniform3f(u('uBase'), params.base[0], params.base[1], params.base[2])
      gl.uniform1f(u('uBaseGamma'), params.baseGamma)
      gl.uniform1f(u('uSpecCut'), params.specCut)
      gl.uniform1f(u('uSpecAmount'), params.specAmount)
      gl.uniform1f(u('uThrough'), params.through ? 1 : 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      Object.values(tex).forEach((t) => gl.deleteTexture(t))
      gl.deleteBuffer(buf)
      gl.deleteProgram(program)
    },
  }
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  // CLAMP_TO_EDGE обязателен: смещение уводит выборку за край, и без него
  // принт заворачивался бы с противоположной стороны изделия.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return t
}

function upload(gl: WebGL2RenderingContext, t: WebGLTexture | null, unit: number, src: TexImageSource) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
}

function uploadGray(
  gl: WebGL2RenderingContext,
  t: WebGLTexture | null,
  unit: number,
  data: Uint8ClampedArray,
  w: number,
  h: number,
) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(data))
}

function bindUnit(gl: WebGL2RenderingContext, p: WebGLProgram, name: string, unit: number) {
  gl.uniform1i(gl.getUniformLocation(p, name), unit)
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      // Молчаливо не падаем: шейдер, не собравшийся без объяснения, ищут часами.
      console.error('шейдер не собрался:', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }
  const v = compile(gl.VERTEX_SHADER, vs)
  const f = compile(gl.FRAGMENT_SHADER, fs)
  if (!v || !f) return null
  const p = gl.createProgram()
  if (!p) return null
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('программа не слинковалась:', gl.getProgramInfoLog(p))
    return null
  }
  return p
}
