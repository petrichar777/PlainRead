//! IPC 契约层。
//!
//! 这一层是 Rust 与前端之间**唯一的**数据出入口。两件事都在这里定义：
//!
//! - [`dto`]：穿越边界的数据形状（并自动生成 TypeScript 类型）
//! - [`mapping`]：内核领域类型 → DTO 的转换
//!
//! 为什么要有 `mapping` 这层"多余"的转换，见 [`dto`] 顶部的说明。

pub mod dto;
pub mod mapping;
