// GPU-resident variant: reads the raw CFA as u16 (R16Uint, half the upload of f32), does the
// black/white scaling in-shader, stages a 20x20 tile (16x16 + 2px apron) in workgroup memory,
// then applies Malvar–He–Cutler + WB + camera->sRGB. Output stays on the GPU (rgba16float).
struct Params {
    roi: vec4<u32>,
    out_rect: vec4<u32>,
    pattern: vec4<u32>,
    wb: vec4<f32>,
    m0: vec4<f32>,
    m1: vec4<f32>,
    m2: vec4<f32>,
    black: vec4<f32>,   // per CFA phase (0,0),(0,1),(1,0),(1,1)
    inv_range: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<u32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p: Params;

const T: u32 = 16u;
const A: u32 = 2u;
const S: u32 = 20u; // T + 2A
var<workgroup> tile: array<f32, 400>;

fn mirror(v: i32, n: i32) -> i32 {
    var r = v;
    if (r < 0) { r = -r; }
    if (r >= n) { r = 2 * (n - 1) - r; }
    return r;
}

fn load_scaled(x: i32, y: i32) -> f32 {
    let xx = mirror(x, i32(p.roi.z));
    let yy = mirror(y, i32(p.roi.w));
    let v = f32(textureLoad(src, vec2<i32>(xx + i32(p.roi.x), yy + i32(p.roi.y)), 0).r);
    let phase = u32((yy + i32(p.roi.y)) & 1) * 2u + u32((xx + i32(p.roi.x)) & 1);
    return max(v - p.black[phase], 0.0) * p.inv_range[phase];
}

fn t(lx: i32, ly: i32) -> f32 {
    return tile[u32(ly + i32(A)) * S + u32(lx + i32(A))];
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    let ox0 = i32(wg.x * T + p.out_rect.x);
    let oy0 = i32(wg.y * T + p.out_rect.y);
    // Cooperative load of the 20x20 tile (400 samples, 256 threads).
    let li = lid.y * T + lid.x;
    for (var k = li; k < S * S; k = k + 256u) {
        let tx = i32(k % S) - i32(A);
        let ty = i32(k / S) - i32(A);
        tile[k] = load_scaled(ox0 + tx, oy0 + ty);
    }
    workgroupBarrier();

    let gx = wg.x * T + lid.x;
    let gy = wg.y * T + lid.y;
    if (gx >= p.out_rect.z || gy >= p.out_rect.w) { return; }
    let xu = gx + p.out_rect.x;
    let yu = gy + p.out_rect.y;
    let x = i32(lid.x);
    let y = i32(lid.y);
    let c = t(x, y);
    let color = p.pattern[(yu & 1u) * 2u + (xu & 1u)];
    var rgb: vec3<f32>;
    if (color == 1u) {
        let horiz = p.pattern[(yu & 1u) * 2u + ((xu + 1u) & 1u)];
        let n4 = t(x - 1, y - 1) + t(x + 1, y - 1) + t(x - 1, y + 1) + t(x + 1, y + 1);
        let theta = (5.0 * c + 4.0 * (t(x - 1, y) + t(x + 1, y)) - (t(x - 2, y) + t(x + 2, y)) - n4
            + 0.5 * (t(x, y - 2) + t(x, y + 2))) * 0.125;
        let phi = (5.0 * c + 4.0 * (t(x, y - 1) + t(x, y + 1)) - (t(x, y - 2) + t(x, y + 2)) - n4
            + 0.5 * (t(x - 2, y) + t(x + 2, y))) * 0.125;
        if (horiz == 0u) { rgb = vec3<f32>(theta, c, phi); } else { rgb = vec3<f32>(phi, c, theta); }
    } else {
        let cross2 = t(x - 2, y) + t(x + 2, y) + t(x, y - 2) + t(x, y + 2);
        let g = (4.0 * c + 2.0 * (t(x - 1, y) + t(x + 1, y) + t(x, y - 1) + t(x, y + 1)) - cross2) * 0.125;
        let opp = (6.0 * c + 2.0 * (t(x - 1, y - 1) + t(x + 1, y - 1) + t(x - 1, y + 1) + t(x + 1, y + 1)) - 1.5 * cross2) * 0.125;
        if (color == 0u) { rgb = vec3<f32>(c, g, opp); } else { rgb = vec3<f32>(opp, g, c); }
    }
    let w = rgb * p.wb.xyz;
    let out = vec3<f32>(dot(p.m0.xyz, w), dot(p.m1.xyz, w), dot(p.m2.xyz, w));
    textureStore(dst, vec2<i32>(i32(gx), i32(gy)), vec4<f32>(out, 1.0));
}
