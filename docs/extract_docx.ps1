Add-Type -AssemblyName System.IO.Compression.FileSystem
$docxPath = "c:\xampp\htdocs\salaam-hospital-referral-admission-system\Responsive-Web-Based-Patient-Referral-and-Admission-System-for-Salaam-Hospital-revise-paper......docx"
$outPath = "c:\xampp\htdocs\salaam-hospital-referral-admission-system\docs\paper_full_text.txt"

$zip = [System.IO.Compression.ZipFile]::OpenRead($docxPath)
$entry = $zip.GetEntry("word/document.xml")
$sr = New-Object System.IO.StreamReader($entry.Open())
$xmlContent = $sr.ReadToEnd()
$sr.Close()
$zip.Dispose()

$xml = [xml]$xmlContent
$nsMgr = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$nsMgr.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
$nodes = $xml.SelectNodes("//w:p", $nsMgr)

$lines = @()
foreach ($para in $nodes) {
    $texts = $para.SelectNodes(".//w:t", $nsMgr)
    $line = ($texts | ForEach-Object { $_.InnerText }) -join ""
    $lines += $line
}

$result = $lines -join "`n"
$result | Out-File -Encoding utf8 $outPath
Write-Host "Extracted $($result.Length) chars to paper_full_text.txt"
