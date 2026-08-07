param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
        $_.Name -eq "AsTask" -and
        $_.IsGenericMethod -and
        $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

function Await-WinRt([object]$Operation, [type]$ResultType) {
    $method = $asTaskMethod.MakeGenericMethod($ResultType)
    $task = $method.Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

$storageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$fileAccessModeType = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$ocrEngineType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$ocrResultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

$resolvedPath = (Resolve-Path -LiteralPath $ImagePath).Path
$file = Await-WinRt ($storageFileType::GetFileFromPathAsync($resolvedPath)) $storageFileType
$stream = Await-WinRt ($file.OpenAsync($fileAccessModeType::Read)) $streamType
$decoder = Await-WinRt ($decoderType::CreateAsync($stream)) $decoderType
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) $bitmapType
$engine = $ocrEngineType::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    throw "Windows OCR language support is unavailable."
}
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) $ocrResultType
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result.Text
