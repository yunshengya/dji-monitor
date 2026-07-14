# DJI 换购机型下拉列表监控

监控地址：

https://support.dji.com/recycle/apply

## 功能

- GitHub Actions 每小时运行一次
- 使用 Playwright 打开网页并展开“换购机型版本”
- 支持滚动读取虚拟下拉列表
- 首次运行保存基准名单
- 后续发现新增、删除或改名时自动创建 GitHub Issue
- 每次运行保留调试截图 7 天

## 使用方法

1. 在 GitHub 新建一个仓库。
2. 把本项目所有文件上传到仓库根目录。
3. 打开仓库的 **Actions** 页面。
4. 点击左侧 **Monitor DJI recycle models**。
5. 点击 **Run workflow** 手动运行一次。
6. 首次成功后，仓库中会自动生成 `data/dji-models.json`。
7. 后续每小时自动检查；发生变化时，会在仓库的 **Issues** 页面创建通知。

## 必须检查的权限

打开：

**Settings → Actions → General → Workflow permissions**

选择：

**Read and write permissions**

然后保存。否则工作流可能无法提交基准文件或创建 Issue。

## 修改检查频率

编辑 `.github/workflows/monitor.yml`：

```yaml
- cron: '17 * * * *'
```

这是每小时一次。GitHub Actions 的 cron 使用 UTC，但这个表达式只关心每小时的第 17 分钟，所以不受时区影响。

例如每 30 分钟：

```yaml
- cron: '7,37 * * * *'
```

## 查看故障截图

进入某次 Actions 运行记录，在页面底部下载：

`dji-monitor-debug-运行编号`

如果 DJI 改了页面结构，可以根据截图调整 `scripts/monitor.mjs` 中的选择器。
