struct BlurParams {
    radius: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    input_width: u32,
    input_height: u32,
    _pad1: u32,
    _pad2: u32,
    _pad3: u32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;

const F16_MAX = 65504.0;

// Separable Gaussian. Weights use the recurrence g(k+1) = g(k) * a^(2k+1), a = exp(-1/(2 sigma^2)),
// so there is one exp() per pixel instead of one per tap; taps are taken symmetrically in pairs.

@compute @workgroup_size(256, 1, 1)
fn horizontal_blur(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.input_width || id.y >= params.input_height) {
        return;
    }

    let radius = i32(params.radius);
    let sigma = f32(radius) / 2.0;
    let a = exp(-1.0 / (2.0 * sigma * sigma));

    let ax = i32(id.x + params.tile_offset_x);
    let ay = i32(id.y + params.tile_offset_y);
    let max_x = i32(textureDimensions(input_texture).x) - 1;

    var total_color = clamp(textureLoad(input_texture, vec2<i32>(ax, ay), 0).rgb, vec3(0.0), vec3(F16_MAX));
    var total_weight = 1.0;
    var g = 1.0;
    var m = a;
    let a2 = a * a;

    for (var k = 1; k <= radius; k = k + 1) {
        g = g * m;
        m = m * a2;
        let left = clamp(textureLoad(input_texture, vec2<i32>(clamp(ax - k, 0, max_x), ay), 0).rgb, vec3(0.0), vec3(F16_MAX));
        let right = clamp(textureLoad(input_texture, vec2<i32>(clamp(ax + k, 0, max_x), ay), 0).rgb, vec3(0.0), vec3(F16_MAX));
        total_color += (left + right) * g;
        total_weight += 2.0 * g;
    }

    textureStore(output_texture, id.xy, vec4<f32>(total_color / total_weight, 1.0));
}

// 16x16 workgroups so neighbouring threads read neighbouring columns (coalesced), unlike a
// 1x256 column-per-workgroup layout.
@compute @workgroup_size(16, 16, 1)
fn vertical_blur(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.input_width || id.y >= params.input_height) {
        return;
    }

    let radius = i32(params.radius);
    let sigma = f32(radius) / 2.0;
    let a = exp(-1.0 / (2.0 * sigma * sigma));
    let max_y = i32(params.input_height) - 1;
    let x = i32(id.x);
    let y = i32(id.y);

    var total_color = clamp(textureLoad(input_texture, vec2<i32>(x, y), 0).rgb, vec3(0.0), vec3(F16_MAX));
    var total_weight = 1.0;
    var g = 1.0;
    var m = a;
    let a2 = a * a;

    for (var k = 1; k <= radius; k = k + 1) {
        g = g * m;
        m = m * a2;
        let up = clamp(textureLoad(input_texture, vec2<i32>(x, clamp(y - k, 0, max_y)), 0).rgb, vec3(0.0), vec3(F16_MAX));
        let down = clamp(textureLoad(input_texture, vec2<i32>(x, clamp(y + k, 0, max_y)), 0).rgb, vec3(0.0), vec3(F16_MAX));
        total_color += (up + down) * g;
        total_weight += 2.0 * g;
    }

    textureStore(output_texture, id.xy, vec4<f32>(total_color / total_weight, 1.0));
}
