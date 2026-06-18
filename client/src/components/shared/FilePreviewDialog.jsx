import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, FileQuestion } from 'lucide-react';

/**
 * Previews a single file given a blob/object URL and its MIME type.
 * Images render inline, PDFs in an iframe; every other type (spreadsheets,
 * docs, …) falls back to a download link. We intentionally never render
 * arbitrary types in an iframe — a blob URL inherits the app origin, so an
 * uploaded HTML/SVG could otherwise execute script in our context.
 *
 * `file` = { url, name, type } | null  (null closes the dialog).
 */
export default function FilePreviewDialog({ file, onOpenChange }) {
  const type = file?.type || '';
  const isImage = type.startsWith('image/');
  const isPdf = type === 'application/pdf';

  return (
    <Dialog open={Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="truncate pr-8">{file?.name || 'Preview'}</DialogTitle>
          {file?.url && (
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
            </a>
          )}
        </DialogHeader>

        {file?.url && isImage && (
          <div className="flex max-h-[75vh] justify-center overflow-auto p-4">
            <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}

        {file?.url && isPdf && (
          <iframe title={file.name} src={file.url} className="h-[75vh] w-full rounded-b-2xl border-0" />
        )}

        {file?.url && !isImage && !isPdf && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <FileQuestion className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Inline preview isn&rsquo;t available for this file type. Download it to view.
            </p>
            <Button asChild variant="outline">
              <a href={file.url} download={file.name}>
                <Download className="h-4 w-4" /> Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
