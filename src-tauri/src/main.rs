// release 构建下不附带控制台窗口（仅影响 Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    postkiddie_lib::run();
}
