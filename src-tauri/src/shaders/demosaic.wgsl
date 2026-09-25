// Malvar–He–Cutler Bayer demosaic + white balance + camera->sRGB matrix, one thread per pixel.
struct Params {
    roi: vec4<u32>,      // x, y, w, h (active area in the raw texture)
    out_rect: vec4<u32>, // x, y, w, h (output crop, relative to the ROI)
    pattern: vec4<u32>,  // CFA colour at (0,0),(0,1),(1,0),(1,1) relative to the ROI
    wb: vec4<f32>,
    m0: vec4<f32>,
    m1: vec4<f32>,
    m2: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p: Params;

fn mirror(v: i32, n: i32) -> i32 {
    var r = v;
    if (r < 0) { r = -r; }
    if (r >= n) { r = 2 * (n - 1) - r; }
    return r;
}

fn s(x: i32, y: i32) -> f32 {
    let xx = mirror(x, i32(p.roi.z));
    let yy = mirror(y, i32(p.roi.w));
    return textureLoad(src, vec2<i32>(xx + i32(p.roi.x), yy + i32(p.roi.y)), 0).r;
}

fn color_at(x: u32, y: u32) -> u32 {
    let i = (y & 1u) * 2u + (x & 1u);
    return p.pattern[i];
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= p.out_rect.z || id.y >= p.out_rect.w) { return; }
    let xu = id.x + p.out_rect.x;
    let yu = id.y + p.out_rect.y;
    let x = i32(xu);
    let y = i32(yu);
    let c = s(x, y);
    let color = color_at(xu, yu);
    var rgb: vec3<f32>;
    if (color == 1u) {
        let horiz = color_at(xu + 1u, yu);
        let n4 = s(x - 1, y - 1) + s(x + 1, y - 1) + s(x - 1, y + 1) + s(x + 1, y + 1);
        let theta = (5.0 * c + 4.0 * (s(x - 1, y) + s(x + 1, y)) - (s(x - 2, y) + s(x + 2, y)) - n4
            + 0.5 * (s(x, y - 2) + s(x, y + 2))) * 0.125;
        let phi = (5.0 * c + 4.0 * (s(x, y - 1) + s(x, y + 1)) - (s(x, y - 2) + s(x, y + 2)) - n4
            + 0.5 * (s(x - 2, y) + s(x + 2, y))) * 0.125;
        if (horiz == 0u) { rgb = vec3<f32>(theta, c, phi); } else { rgb = vec3<f32>(phi, c, theta); }
    } else {
        let cross2 = s(x - 2, y) + s(x + 2, y) + s(x, y - 2) + s(x, y + 2);
        let g = (4.0 * c + 2.0 * (s(x - 1, y) + s(x + 1, y) + s(x, y - 1) + s(x, y + 1)) - cross2) * 0.125;
        let opp = (6.0 * c + 2.0 * (s(x - 1, y - 1) + s(x + 1, y - 1) + s(x - 1, y + 1) + s(x + 1, y + 1)) - 1.5 * cross2) * 0.125;
        if (color == 0u) { rgb = vec3<f32>(c, g, opp); } else { rgb = vec3<f32>(opp, g, c); }
    }
    let w = rgb * p.wb.xyz;
    let out = vec3<f32>(dot(p.m0.xyz, w), dot(p.m1.xyz, w), dot(p.m2.xyz, w));
    textureStore(dst, vec2<i32>(i32(id.x), i32(id.y)), vec4<f32>(out, 1.0));
}
