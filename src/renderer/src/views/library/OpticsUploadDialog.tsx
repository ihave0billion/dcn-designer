import { useEffect, useState } from 'react'
import { CheckCircle2, FileText, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useWorkspace } from '@/state/WorkspaceContext'
import { saveOpticsFile } from '@/lib/library-io'
import { parseTmgOpticsCsv, type ParseResult } from '@/lib/optics-csv-parser'
import type { Switch } from '@/schemas/switches'
import type { DcnOpticsIndexEntry } from '../../../../preload/types'

interface OpticsUploadDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  switches: Switch[]
  existingEntries: DcnOpticsIndexEntry[]
  onDone(switchId: string): void
}

type Stage = 'pick' | 'preview' | 'saving' | 'done'

export function OpticsUploadDialog({
  open,
  onOpenChange,
  switches,
  existingEntries,
  onDone
}: OpticsUploadDialogProps) {
  const { workspacePath } = useWorkspace()
  const [stage, setStage] = useState<Stage>('pick')
  const [selectedSwitchId, setSelectedSwitchId] = useState<string>('')
  const [csvName, setCsvName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setStage('pick')
      setSelectedSwitchId('')
      setCsvName(null)
      setParseResult(null)
      setErr(null)
      setConfirmReplaceOpen(false)
    }
  }, [open])

  const existing = existingEntries.find((e) => e.switch_id === selectedSwitchId)

  async function handlePickCsv() {
    if (!selectedSwitchId) {
      setErr('Pick a target switch first.')
      return
    }
    setErr(null)
    try {
      const result = await window.dcn.showCsvPicker(`Optics CSV for ${selectedSwitchId}`)
      if (!result) return
      setCsvName(result.basename)
      const text = await window.dcn.readTextFile(result.path)
      const parsed = parseTmgOpticsCsv(text, selectedSwitchId)
      setParseResult(parsed)
      setStage('preview')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSave() {
    if (!workspacePath || !parseResult || !selectedSwitchId) return
    if (existing) {
      setConfirmReplaceOpen(true)
      return
    }
    await persist()
  }

  async function persist() {
    if (!workspacePath || !parseResult || !selectedSwitchId) return
    setStage('saving')
    setErr(null)
    try {
      await saveOpticsFile(
        workspacePath,
        selectedSwitchId,
        parseResult.optics,
        csvName,
        new Date().toISOString()
      )
      setStage('done')
      onDone(selectedSwitchId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setStage('preview')
    } finally {
      setConfirmReplaceOpen(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload optics CSV</DialogTitle>
            <DialogDescription>
              Pick a target switch, then upload its Cisco TMG compatibility export. Rows whose{' '}
              <code className="font-mono text-xs">Network Device Product ID</code> doesn't match
              the target switch are skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Target switch</Label>
              <Select
                value={selectedSwitchId}
                onValueChange={(v) => {
                  setSelectedSwitchId(v)
                  setCsvName(null)
                  setParseResult(null)
                  setStage('pick')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a switch from the library…" />
                </SelectTrigger>
                <SelectContent>
                  {switches.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No switches in library — add one under the Switches tab first.
                    </SelectItem>
                  ) : (
                    switches.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-mono text-xs">{s.id}</span> — {s.model_display}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {existing && (
                <p className="text-xs text-muted-foreground">
                  This switch already has {existing.optic_count} optic{existing.optic_count === 1 ? '' : 's'} imported.
                  You'll be asked to confirm before replacing.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>CSV file</Label>
              <div className="flex gap-2 items-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePickCsv}
                  disabled={!selectedSwitchId}
                >
                  <FileText />
                  Choose CSV…
                </Button>
                {csvName && (
                  <span className="text-xs text-muted-foreground truncate">{csvName}</span>
                )}
              </div>
            </div>

            {stage === 'preview' && parseResult && (
              <div className="border rounded-md p-4 space-y-2 bg-muted/20">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-green-600" />
                  Parsed {parseResult.summary.optic_count} unique optic
                  {parseResult.summary.optic_count === 1 ? '' : 's'} from{' '}
                  {parseResult.summary.row_count} CSV row
                  {parseResult.summary.row_count === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {parseResult.summary.rows_skipped_other_switch > 0 && (
                    <div>
                      • {parseResult.summary.rows_skipped_other_switch} row
                      {parseResult.summary.rows_skipped_other_switch === 1 ? '' : 's'} skipped
                      (different switch ID)
                    </div>
                  )}
                  {parseResult.summary.rows_skipped_no_pid > 0 && (
                    <div>
                      • {parseResult.summary.rows_skipped_no_pid} row
                      {parseResult.summary.rows_skipped_no_pid === 1 ? '' : 's'} skipped (missing
                      transceiver PID)
                    </div>
                  )}
                  {parseResult.summary.rows_skipped_malformed > 0 && (
                    <div>
                      • {parseResult.summary.rows_skipped_malformed} row
                      {parseResult.summary.rows_skipped_malformed === 1 ? '' : 's'} skipped
                      (malformed — likely unquoted embedded newlines)
                    </div>
                  )}
                  {parseResult.summary.warnings.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">
                        {parseResult.summary.warnings.length} warning
                        {parseResult.summary.warnings.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-1 pl-4 list-disc">
                        {parseResult.summary.warnings.slice(0, 10).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                        {parseResult.summary.warnings.length > 10 && (
                          <li>… and {parseResult.summary.warnings.length - 10} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
                {parseResult.summary.optic_count === 0 && (
                  <div className="text-sm text-destructive">
                    No optics matched the selected switch. Check that the CSV's{' '}
                    <code className="font-mono text-xs">Network Device Product ID</code> column
                    matches <code className="font-mono text-xs">{selectedSwitchId}</code>.
                  </div>
                )}
              </div>
            )}

            {err && <div className="text-sm text-destructive">{err}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                stage !== 'preview' ||
                !parseResult ||
                parseResult.summary.optic_count === 0
              }
            >
              <Upload />
              {stage === 'saving' ? 'Saving…' : existing ? 'Replace existing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing optics?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="font-mono">{selectedSwitchId}</code> already has{' '}
              {existing?.optic_count} optic{existing?.optic_count === 1 ? '' : 's'} imported from{' '}
              <code className="font-mono text-xs">{existing?.source_csv ?? 'a previous CSV'}</code>.
              Replacing will overwrite the file with the {parseResult?.summary.optic_count ?? 0}{' '}
              optic{parseResult?.summary.optic_count === 1 ? '' : 's'} from the new CSV. Any hand
              edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep existing</AlertDialogCancel>
            <AlertDialogAction onClick={persist}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
