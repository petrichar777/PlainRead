//! redb 仓储（ADR-002）。
//!
//! # 为什么是 redb
//!
//! 纯 Rust 单文件 KV，无 C 依赖 → Android 交叉编译零负担；
//! ACID 写事务足够本项目"书籍元数据 + 章节索引 + 进度"的规模。
//!
//! # 表布局（docs/03 M1 交付物：六表）
//!
//! | 表 | key | value | 用途 |
//! |---|---|---|---|
//! | `books` | 16B book_id | postcard `Book` | 书架列表 |
//! | `chapters` | 16B book_id | postcard `Vec<Chapter>` | 章节索引 blob（§6.4） |
//! | `progress` | 16B book_id | postcard `ReadingProgress` | 每本书一条 |
//! | `bookmarks` | 16B bookmark_id | postcard `Bookmark` | 书签实体 |
//! | `bm_by_book` | 32B book_id‖bookmark_id | 空 | 书架删除时的书签倒排 |
//! | `settings` | &str | 字节 | 全局设置（M3 启用） |
//!
//! 序列化统一走 postcard（serde derive 已在领域类型上），
//! key 统一用 uuid 的 16 字节原始形式——红果果的 `&[u8]` 表类型，零 trait 样板。

use std::collections::HashMap;
use std::path::Path;

use redb::{Database, ReadableTable, TableDefinition};

use crate::domain::{Book, BookId, BookmarkId, Chapter, ReadingProgress};

const BOOKS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("books");
const CHAPTERS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("chapters");
const PROGRESS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("progress");
const BOOKMARKS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("bookmarks");
/// 倒排：书 → 书签集合。value 恒为空字节串。
const BM_BY_BOOK: TableDefinition<&[u8], &[u8]> = TableDefinition::new("bm_by_book");
const SETTINGS: TableDefinition<&str, &[u8]> = TableDefinition::new("settings");

/// 存储层错误。外壳（Tauri 命令层）负责把它映射成 [`crate::` 无关] 的应用错误码。
#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    Database(String),
    /// 结构损坏：落库字节反序列化失败（理论上只在手工改库时出现）
    Corrupt(&'static str),
    NotFound,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "IO 错误: {e}"),
            Self::Database(e) => write!(f, "数据库错误: {e}"),
            Self::Corrupt(what) => write!(f, "存储数据损坏: {what}"),
            Self::NotFound => write!(f, "记录不存在"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

fn db_err<E: std::fmt::Display>(e: E) -> StoreError {
    StoreError::Database(e.to_string())
}

fn key_of(id: BookId) -> [u8; 16] {
    *id.as_uuid().as_bytes()
}

/// 书库仓储。一个应用实例对应一个 `library.redb` 文件。
pub struct Library {
    db: Database,
}

impl Library {
    /// 打开（不存在则创建）库文件，并确保六张表都已建好。
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let db = Database::create(path).map_err(db_err)?;
        let txn = db.begin_write().map_err(db_err)?;
        {
            txn.open_table(BOOKS).map_err(db_err)?;
            txn.open_table(CHAPTERS).map_err(db_err)?;
            txn.open_table(PROGRESS).map_err(db_err)?;
            txn.open_table(BOOKMARKS).map_err(db_err)?;
            txn.open_table(BM_BY_BOOK).map_err(db_err)?;
            txn.open_table(SETTINGS).map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(Self { db })
    }

    /// 写入一本书与其章节索引（同一事务，二者要么都进要么都不进）。
    pub fn insert_book(&self, book: &Book, chapters: &[Chapter]) -> Result<(), StoreError> {
        let book_bytes =
            postcard::to_allocvec(book).map_err(|_| StoreError::Corrupt("Book 序列化失败"))?;
        let chapters_bytes = postcard::to_allocvec(chapters)
            .map_err(|_| StoreError::Corrupt("Chapter 序列化失败"))?;

        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut books = txn.open_table(BOOKS).map_err(db_err)?;
            let mut chapter_table = txn.open_table(CHAPTERS).map_err(db_err)?;
            books
                .insert(key_of(book.id).as_slice(), book_bytes.as_slice())
                .map_err(db_err)?;
            chapter_table
                .insert(key_of(book.id).as_slice(), chapters_bytes.as_slice())
                .map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }

    /// 全部书籍（不保证顺序；外壳按最近阅读排序）。
    pub fn list_books(&self) -> Result<Vec<Book>, StoreError> {
        Ok(self
            .list_books_with_progress()?
            .into_iter()
            .map(|(b, _)| b)
            .collect())
    }

    /// 书架页的批量读：书籍 + 各自进度，单次读事务。
    pub fn list_books_with_progress(
        &self,
    ) -> Result<Vec<(Book, Option<ReadingProgress>)>, StoreError> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let books = txn.open_table(BOOKS).map_err(db_err)?;
        let progress = txn.open_table(PROGRESS).map_err(db_err)?;

        let mut progress_map: HashMap<[u8; 16], ReadingProgress> = HashMap::new();
        for row in progress.iter().map_err(db_err)? {
            let (k, v) = row.map_err(db_err)?;
            let value_bytes = v.value();
            let parsed: ReadingProgress = postcard::from_bytes(value_bytes)
                .map_err(|_| StoreError::Corrupt("ReadingProgress 反序列化失败"))?;
            let mut key = [0u8; 16];
            key.copy_from_slice(k.value());
            progress_map.insert(key, parsed);
        }

        let mut out = Vec::new();
        for row in books.iter().map_err(db_err)? {
            let (k, v) = row.map_err(db_err)?;
            let value_bytes = v.value();
            let book: Book = postcard::from_bytes(value_bytes)
                .map_err(|_| StoreError::Corrupt("Book 反序列化失败"))?;
            let mut key = [0u8; 16];
            key.copy_from_slice(k.value());
            out.push((book, progress_map.get(&key).copied()));
        }
        Ok(out)
    }

    pub fn get_book(&self, id: BookId) -> Result<Option<Book>, StoreError> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let books = txn.open_table(BOOKS).map_err(db_err)?;
        match books.get(key_of(id).as_slice()).map_err(db_err)? {
            Some(v) => {
                let value_bytes = v.value();
                let book: Book = postcard::from_bytes(value_bytes)
                    .map_err(|_| StoreError::Corrupt("Book 反序列化失败"))?;
                Ok(Some(book))
            }
            None => Ok(None),
        }
    }

    /// 按内容哈希找书（导入查重用）。书架规模（几百本）线性扫描足够；
    /// 若未来上万本，再加 `content_hash` 倒排表即可，接口不变。
    pub fn find_book_by_hash(&self, hash: u64) -> Result<Option<Book>, StoreError> {
        Ok(self
            .list_books()?
            .into_iter()
            .find(|b| b.content_hash == hash))
    }

    /// 读取某书的章节索引。
    pub fn get_chapters(&self, id: BookId) -> Result<Vec<Chapter>, StoreError> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let chapters = txn.open_table(CHAPTERS).map_err(db_err)?;
        match chapters.get(key_of(id).as_slice()).map_err(db_err)? {
            Some(v) => {
                let value_bytes = v.value();
                let parsed: Vec<Chapter> = postcard::from_bytes(value_bytes)
                    .map_err(|_| StoreError::Corrupt("Chapter 反序列化失败"))?;
                Ok(parsed)
            }
            None => Ok(Vec::new()),
        }
    }

    /// 改书名。找不到书返回 [`StoreError::NotFound`]。
    pub fn update_title(&self, id: BookId, title: &str) -> Result<Book, StoreError> {
        let mut book = self.get_book(id)?.ok_or(StoreError::NotFound)?;
        book.title = title.to_string();
        self.insert_book(&book, &self.get_chapters(id)?)?;
        Ok(book)
    }

    /// 删除一本书的**全部**落库痕迹：书籍、章节、进度、书签、书签倒排。
    /// 不存在的键静默跳过（幂等，重试安全）。
    pub fn delete_book(&self, id: BookId) -> Result<(), StoreError> {
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut books = txn.open_table(BOOKS).map_err(db_err)?;
            let mut chapters = txn.open_table(CHAPTERS).map_err(db_err)?;
            let mut progress = txn.open_table(PROGRESS).map_err(db_err)?;
            let mut bookmarks = txn.open_table(BOOKMARKS).map_err(db_err)?;
            let mut bm_by_book = txn.open_table(BM_BY_BOOK).map_err(db_err)?;

            let _ = books.remove(key_of(id).as_slice());
            let _ = chapters.remove(key_of(id).as_slice());
            let _ = progress.remove(key_of(id).as_slice());

            // 收集该书全部书签 id（读 value 里的 book_id 字段）
            let mut doomed: Vec<Vec<u8>> = Vec::new();
            for row in bookmarks.iter().map_err(db_err)? {
                let (k, v) = row.map_err(db_err)?;
                let value_bytes = v.value();
                if let Ok(b) = postcard::from_bytes::<crate::domain::Bookmark>(value_bytes) {
                    if b.book_id == id {
                        doomed.push(k.value().to_vec());
                    }
                }
            }
            for bk in doomed {
                let _ = bookmarks.remove(bk.as_slice());
                let mut composite = key_of(id).to_vec();
                composite.extend_from_slice(&bk);
                let _ = bm_by_book.remove(composite.as_slice());
            }
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }

    pub fn get_progress(&self, id: BookId) -> Result<Option<ReadingProgress>, StoreError> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let progress = txn.open_table(PROGRESS).map_err(db_err)?;
        match progress.get(key_of(id).as_slice()).map_err(db_err)? {
            Some(v) => {
                let value_bytes = v.value();
                let parsed: ReadingProgress = postcard::from_bytes(value_bytes)
                    .map_err(|_| StoreError::Corrupt("ReadingProgress 反序列化失败"))?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    pub fn save_progress(&self, p: &ReadingProgress) -> Result<(), StoreError> {
        let bytes = postcard::to_allocvec(p)
            .map_err(|_| StoreError::Corrupt("ReadingProgress 序列化失败"))?;
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut progress = txn.open_table(PROGRESS).map_err(db_err)?;
            progress
                .insert(key_of(p.book_id).as_slice(), bytes.as_slice())
                .map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }

    /// 记录一次阅读：写进度表 **并** 触碰 `books.last_read_at`（同一写事务）。
    ///
    /// 独立于 [`Self::save_progress`] 而不是直接改它，是因为二者语义不同：
    /// `save_progress` 是纯粹的"进度落盘"；而阅读命令的每次上报都意味着"读了"，
    /// 书架的"最近阅读"排序与相对时间依赖 `last_read_at` 同步刷新——
    /// 两个写要么都发生要么都不发生，不能让书架显示"3 天前读过"而进度是 5 分钟前的。
    /// 书不存在时只写进度不建书（调用方应在命令层先校验书存在）。
    pub fn record_reading(&self, p: &ReadingProgress) -> Result<(), StoreError> {
        let bytes = postcard::to_allocvec(p)
            .map_err(|_| StoreError::Corrupt("ReadingProgress 序列化失败"))?;
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut progress = txn.open_table(PROGRESS).map_err(db_err)?;
            progress
                .insert(key_of(p.book_id).as_slice(), bytes.as_slice())
                .map_err(db_err)?;

            let mut books = txn.open_table(BOOKS).map_err(db_err)?;
            // 先把原值拷出作用域（redb 的读守卫与后续 insert 的写借用互斥）
            let existing: Option<Vec<u8>> = books
                .get(key_of(p.book_id).as_slice())
                .map_err(db_err)?
                .map(|row| row.value().to_vec());
            if let Some(bytes) = existing {
                let mut book: Book = postcard::from_bytes(&bytes)
                    .map_err(|_| StoreError::Corrupt("Book 反序列化失败"))?;
                book.last_read_at = Some(p.updated_at);
                let book_bytes = postcard::to_allocvec(&book)
                    .map_err(|_| StoreError::Corrupt("Book 序列化失败"))?;
                books
                    .insert(key_of(p.book_id).as_slice(), book_bytes.as_slice())
                    .map_err(db_err)?;
            }
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }

    /// 读某本书的全部书签，按阅读位置（章号 → 章内偏移）排序。
    ///
    /// 走 `bm_by_book` 前缀扫描（32B = book_id ‖ bookmark_id），
    /// 不遍历全表——书签总量会随阅读时长增长，全表扫是 O(全部书签)。
    /// 倒排里可能有孤儿（实体已删但倒排残留）：读不到实体就顺手清掉，自我修复。
    pub fn list_bookmarks(&self, book_id: BookId) -> Result<Vec<crate::domain::Bookmark>, StoreError> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let bookmarks = txn.open_table(BOOKMARKS).map_err(db_err)?;
        let bm_by_book = txn.open_table(BM_BY_BOOK).map_err(db_err)?;

        let prefix = key_of(book_id);
        let mut out = Vec::new();
        for row in bm_by_book.iter().map_err(db_err)? {
            let (k, _) = row.map_err(db_err)?;
            let key = k.value();
            if key.len() != 32 || &key[..16] != prefix.as_slice() {
                continue;
            }
            let Some(bytes) = bookmarks.get(&key[16..32]).map_err(db_err)? else {
                continue;
            };
            let value_bytes = bytes.value();
            if let Ok(b) = postcard::from_bytes::<crate::domain::Bookmark>(value_bytes) {
                out.push(b);
            }
        }
        out.sort_by_key(|b| (b.chapter_index, b.char_offset));
        Ok(out)
    }

    /// 删除一条书签（实体 + 倒排）。**幂等**：不存在也返回 Ok。
    ///
    /// 返回是否真的删掉了实体——前端据此决定提示语，但重复点击不应报错。
    pub fn remove_bookmark(&self, id: BookmarkId) -> Result<bool, StoreError> {
        let bk_key = *id.as_uuid().as_bytes();
        let txn = self.db.begin_write().map_err(db_err)?;
        let mut removed = false;
        {
            let mut bookmarks = txn.open_table(BOOKMARKS).map_err(db_err)?;
            let mut bm_by_book = txn.open_table(BM_BY_BOOK).map_err(db_err)?;
            // 先读出 book_id 才能定位倒排键：书签实体里存着它
            let book_id = match bookmarks.get(bk_key.as_slice()).map_err(db_err)? {
                Some(v) => {
                    let bytes = v.value();
                    postcard::from_bytes::<crate::domain::Bookmark>(bytes)
                        .ok()
                        .map(|b| b.book_id)
                }
                None => None,
            };
            if bookmarks.remove(bk_key.as_slice()).map_err(db_err)?.is_some() {
                removed = true;
            }
            if let Some(bid) = book_id {
                let mut composite = key_of(bid).to_vec();
                composite.extend_from_slice(&bk_key);
                let _ = bm_by_book.remove(composite.as_slice());
            }
        }
        txn.commit().map_err(db_err)?;
        Ok(removed)
    }

    /// 保存书签（M3 启用，表结构与倒排在这里一并落地）。
    pub fn insert_bookmark(&self, b: &crate::domain::Bookmark) -> Result<(), StoreError> {
        let bytes =
            postcard::to_allocvec(b).map_err(|_| StoreError::Corrupt("Bookmark 序列化失败"))?;
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut bookmarks = txn.open_table(BOOKMARKS).map_err(db_err)?;
            let mut bm_by_book = txn.open_table(BM_BY_BOOK).map_err(db_err)?;
            let bk_key = *b.id.as_uuid().as_bytes();
            bookmarks
                .insert(bk_key.as_slice(), bytes.as_slice())
                .map_err(db_err)?;
            let mut composite = key_of(b.book_id).to_vec();
            composite.extend_from_slice(&bk_key);
            bm_by_book
                .insert(composite.as_slice(), &b"[]"[..])
                .map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Bookmark, BookmarkId, Timestamp};

    fn sample_book(title: &str) -> Book {
        Book {
            id: BookId::new(),
            title: title.to_string(),
            author: None,
            source_name: format!("{title}.txt"),
            source_encoding: "UTF-8".to_string(),
            byte_size: 123,
            chapter_count: 3,
            has_real_chapters: true,
            content_hash: 42,
            added_at: Timestamp::now(),
            last_read_at: None,
        }
    }

    fn sample_chapters() -> Vec<Chapter> {
        vec![
            Chapter {
                index: 0,
                title: "第一章".into(),
                start: 0,
                end: 10,
            },
            Chapter {
                index: 1,
                title: "第二章".into(),
                start: 10,
                end: 20,
            },
            Chapter {
                index: 2,
                title: "第三章".into(),
                start: 20,
                end: 30,
            },
        ]
    }

    #[test]
    fn book_and_chapters_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();

        let book = sample_book("测试书");
        lib.insert_book(&book, &sample_chapters()).unwrap();

        let loaded = lib.get_book(book.id).unwrap().unwrap();
        assert_eq!(loaded, book);

        let chapters = lib.get_chapters(book.id).unwrap();
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[1].title, "第二章");
    }

    #[test]
    fn list_books_returns_all() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let a = sample_book("甲");
        let b = sample_book("乙");
        lib.insert_book(&a, &sample_chapters()).unwrap();
        lib.insert_book(&b, &sample_chapters()).unwrap();

        let all = lib.list_books().unwrap();
        assert_eq!(all.len(), 2);
        let titles: Vec<&str> = all.iter().map(|x| x.title.as_str()).collect();
        assert!(titles.contains(&"甲") && titles.contains(&"乙"));
    }

    #[test]
    fn update_title_persists() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let book = sample_book("旧名");
        lib.insert_book(&book, &sample_chapters()).unwrap();

        let updated = lib.update_title(book.id, "新名").unwrap();
        assert_eq!(updated.title, "新名");
        assert_eq!(lib.get_book(book.id).unwrap().unwrap().title, "新名");
    }

    #[test]
    fn update_title_missing_book_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        assert!(matches!(
            lib.update_title(BookId::new(), "随便"),
            Err(StoreError::NotFound)
        ));
    }

    #[test]
    fn delete_book_cascades_all_tables() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let book = sample_book("要删的书");
        lib.insert_book(&book, &sample_chapters()).unwrap();
        lib.save_progress(&ReadingProgress {
            book_id: book.id,
            chapter_index: 1,
            char_offset: 5,
            updated_at: Timestamp::now(),
        })
        .unwrap();
        lib.insert_bookmark(&Bookmark {
            id: BookmarkId::new(),
            book_id: book.id,
            chapter_index: 0,
            char_offset: 1,
            excerpt: "摘录".into(),
            created_at: Timestamp::now(),
        })
        .unwrap();

        lib.delete_book(book.id).unwrap();

        assert_eq!(lib.get_book(book.id).unwrap(), None);
        assert!(lib.get_chapters(book.id).unwrap().is_empty());
        assert_eq!(lib.get_progress(book.id).unwrap(), None);
        // 删除是幂等的
        lib.delete_book(book.id).unwrap();
    }

    #[test]
    fn find_by_hash_works() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let book = sample_book("哈希书");
        lib.insert_book(&book, &sample_chapters()).unwrap();

        assert_eq!(lib.find_book_by_hash(42).unwrap().unwrap().id, book.id);
        assert_eq!(lib.find_book_by_hash(999).unwrap(), None);
    }

    #[test]
    fn progress_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let book = sample_book("进度书");
        lib.insert_book(&book, &sample_chapters()).unwrap();

        assert_eq!(lib.get_progress(book.id).unwrap(), None);
        lib.save_progress(&ReadingProgress {
            book_id: book.id,
            chapter_index: 7,
            char_offset: 88,
            updated_at: Timestamp(1234),
        })
        .unwrap();
        let p = lib.get_progress(book.id).unwrap().unwrap();
        assert_eq!((p.chapter_index, p.char_offset), (7, 88));
    }

    #[test]
    fn record_reading_updates_progress_and_last_read_at_together() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(&dir.path().join("library.redb")).unwrap();
        let book = sample_book("阅读书");
        lib.insert_book(&book, &sample_chapters()).unwrap();

        let progress = ReadingProgress {
            book_id: book.id,
            chapter_index: 1,
            char_offset: 42,
            updated_at: Timestamp(5_000),
        };
        lib.record_reading(&progress).unwrap();

        let p = lib.get_progress(book.id).unwrap().unwrap();
        assert_eq!((p.chapter_index, p.char_offset), (1, 42));
        let loaded = lib.get_book(book.id).unwrap().unwrap();
        assert_eq!(loaded.last_read_at, Some(Timestamp(5_000)));

        // 再读一次：last_read_at 必须跟进，书架的"最近阅读"才不会说谎
        lib.record_reading(&ReadingProgress {
            updated_at: Timestamp(9_000),
            ..progress
        })
        .unwrap();
        let loaded = lib.get_book(book.id).unwrap().unwrap();
        assert_eq!(loaded.last_read_at, Some(Timestamp(9_000)));
    }
}
