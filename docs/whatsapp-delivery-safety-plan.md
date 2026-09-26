# Rencana Penguatan Keandalan Pengiriman dan Pengurangan Risiko Pembatasan WhatsApp

Status: **implementasi inti tersedia; pilot belum dilaksanakan**
Tanggal audit: 26 September 2026
Ruang lingkup: WAPBB (`apps/api` dan `apps/web`), khususnya campaign, dispatcher PostgreSQL, dan provider Baileys.

## Ringkasan keputusan

### Progres implementasi lokal

Sudah dibuat di checkout ini: satu campaign `RUNNING` melalui transaction advisory lock, governor PostgreSQL `delivery_safety` per nomor, warm-up tujuh hari, quota menit/jam/hari, jeda acak 45–120 detik, cooldown reconnect, defer job tanpa menambah `attempts`, pause pada 401/403/429/463 yang teridentifikasi, pengikatan campaign ke nomor pengirim, endpoint status dan pemulihan admin, serta ringkasan di panel React. Flag `WA_SAFETY_ENABLED` default `false` agar migrasi dan pilot dapat ditinjau dahulu. Deploy dan pengiriman WhatsApp aktual belum diverifikasi dalam audit ini.

Counter `reservedToday` mengukur slot yang **dicadangkan saat job di-claim**. Bila persiapan gagal sebelum relay, slot tetap terpakai sampai window berganti. Ini sengaja konservatif, tetapi bukan angka pesan yang pasti terkirim. Receipt tetap menjadi sumber untuk status pengantaran. `activated_at` mulai saat klaim pertama akun itu, karena umur SIM/akun WhatsApp tidak tersedia di API.

Masih perlu sebelum produksi: observabilitas dispatch yang lebih rinci, alert operator, penentuan policy berdasarkan riwayat nomor, pengujian cold start/cron, pilot consented, dan hardening auth browser. Fase tersebut tidak diklaim selesai oleh perubahan lokal ini.

WAPBB sudah memiliki fondasi yang baik: consent/opt-in, queue PostgreSQL, lease lintas instance, idempotent message ID, recovery job yang konservatif, session Baileys terenkripsi, dan audit trail. Namun pengiriman belum memiliki *pacing* per nomor yang persisten. Satu pemanggilan dispatcher dapat mengirim semua isi batch secara berurutan dan rapat; dengan nilai bawaan 10, pola tersebut menjadi burst yang tidak cocok untuk nomor baru atau nomor yang lama tidak aktif.

Solusi yang direkomendasikan adalah **delivery safety governor** milik WAPBB, tersimpan di PostgreSQL dan dievaluasi sebelum setiap relay. Ia bukan alat untuk mengakali atau menjamin lolosnya deteksi WhatsApp. Ia membatasi volume, memberi jeda acak yang dapat diaudit, melakukan warm-up konservatif, dan menghentikan campaign bila muncul sinyal risiko. Pengiriman hanya tetap diperbolehkan kepada penerima yang telah memberi persetujuan dan dapat berhenti berlangganan.

Jangan memasang `baileys-antiban` sebagai wrapper otomatis pada fase pertama. Package tersebut berguna sebagai referensi desain, tetapi masih sangat baru, memiliki tiga dependency proxy tambahan, dan mencampurkan kontrol yang bermanfaat (limit/warm-up/health) dengan simulasi perilaku manusia (typing, presence, entropy) yang tidak perlu untuk sistem informasi desa. Menaruh kontrol inti di database WAPBB membuat state selamat dari restart/scale dan dapat diuji tanpa socket WhatsApp nyata.

## Batasan dan prinsip kepatuhan

- Baileys adalah klien tidak resmi. WhatsApp melarang bulk/auto-messaging yang tidak diizinkan; tidak ada konfigurasi yang dapat menjamin akun tidak dibatasi atau diban.
- Persetujuan penerima, konten yang relevan, identitas pengirim yang jelas, frekuensi wajar, dan opt-out yang benar adalah pengurang risiko terbesar. Nilai `opt-in` kosong pada import saat ini berarti `true`; operator wajib hanya mengunggah penerima yang benar-benar sudah menyetujui.
- Fitur tidak akan menambah fake typing, fake presence, spoofing perangkat, variasi tersembunyi pada pesan, atau pola untuk menyamarkan automasi.
- Jangan mengganti nomor saat ada ban untuk melanjutkan campaign yang sama. Hentikan, catat insiden, evaluasi consent/isi/volume, dan gunakan prosedur pemulihan resmi WhatsApp bila diperlukan.

## Temuan audit kode

| Prioritas | Temuan | Dampak | Rekomendasi |
| --- | --- | --- | --- |
| P0 | Dispatcher mengulang hingga `campaign.batchSize` tanpa minimum delay atau limit menit/jam/hari. Nilai default dan maksimum adalah 10 dan 50. | Burst cepat, terutama pada nomor baru; meningkatkan risiko pembatasan dan membuat pola pengiriman tidak stabil. | Terapkan governor persisten sebelum claim/relay; jangan menggunakan `sleep` panjang dalam request scheduler. |
| P0 | Start dan resume tidak menolak campaign `RUNNING` lain, sedangkan dispatcher hanya memilih campaign `RUNNING` tertua. | Campaign kedua tampak berjalan tetapi bisa tidak pernah diproses sampai yang pertama selesai; operator dapat salah mengambil keputusan atau membuat backlog. | Satu campaign aktif per account pada level transaksi/constraint; tampilkan alasan dan campaign yang sedang memegang slot. |
| P1 | Scheduler eksternal direkomendasikan setiap 10 menit dengan batas request 30 detik, sementara Render Free dapat cold start dan dispatcher punya budget 25 detik. | Dispatch dapat tertunda atau kembali `409` ketika socket belum pulih; tidak ada jaminan SLA pengiriman. | Observabilitas dispatch, retry scheduler yang idempoten, status `WAITING_FOR_CONNECTION`, dan uji cold-start sebelum produksi. Pertimbangkan layanan always-on/official API bila SLA penting. |
| P1 | Sinyal risiko belum dikumpulkan menjadi kebijakan. Receipt disimpan baik, tetapi tidak ada threshold delivery/error/disconnect yang otomatis menjeda campaign. | Sistem dapat terus mencoba ketika koneksi/akun memburuk. | Risk state machine, circuit breaker, auto-pause fail-closed, dan alert operator. |
| P1 | Nomor penerima divalidasi ke WhatsApp tepat sebelum setiap kirim. | Menambah round trip dan menjadikan kegagalan lookup transient sebagai retry; tidak membuktikan consent atau kualitas percakapan. | Tetap pertahankan validasi untuk keamanan, tetapi cache hasil singkat per campaign dan kategorikan lookup failure terpisah dari kegagalan relay. |
| P1 | Delivery status `SENT` berarti pesan diserahkan ke provider, bukan pasti diterima/dibaca. | Progres UI dapat dianggap sukses terlalu dini. | Tampilkan `diserahkan`, `terkirim`, `dibaca`, dan `tidak pasti` secara eksplisit; metrik governor memakai receipt/error dengan window minimum agar tidak mudah salah baca. |
| P2 | JWT admin disimpan di `localStorage`; belum tampak header keamanan browser seperti CSP. | Bila terjadi XSS, token dapat dicuri dan campaign dapat dijalankan. | Pisahkan hardening auth sebagai pekerjaan lanjutan: CSP yang kompatibel, hardening headers, dan evaluasi cookie HttpOnly/CSRF. |

Yang **sudah baik** dan harus dipertahankan: pemeriksaan ulang opt-in/nomor sebelum relay, `FOR UPDATE SKIP LOCKED`, lease dispatcher dan socket, ID pesan stabil, larangan retry otomatis pada hasil yang tidak pasti, pausing/cancel sebelum relay, enkripsi session, pembatasan login, CORS allow-list, serta audit mutasi.

## Analisis `kobie3717/baileys-antiban`

Repository yang ditinjau menawarkan rate limiter dengan jitter, warm-up tujuh hari, health monitor, timelock error 463, adaptive throttle dan post-reconnect throttle. Versi npm yang terlihat saat audit adalah `4.10.0` (rilis terakhir 11 Juni 2026), berlisensi MIT, dan menambah `http-proxy-agent`, `https-proxy-agent`, serta `socks-proxy-agent`.

| Komponen referensi | Keputusan untuk WAPBB | Alasan |
| --- | --- | --- |
| Limit menit/jam/hari + minimum interval + jitter | Ambil konsep, implementasi sendiri | Harus atomik dan tahan restart pada PostgreSQL; tidak boleh state in-memory/file pada Render ephemeral. |
| Warm-up nomor baru/inaktif | Ambil, tetapi lebih konservatif | Batas harian harus dapat dikonfigurasi, terlihat sebelum start, dan tidak dapat dilewati operator biasa. |
| Post-reconnect throttle | Ambil | Mencegah backlog langsung meledak sesudah socket kembali. |
| Timelock/403/401/463 dan circuit breaker | Ambil sebagai normalisasi error dan auto-pause | Cocok dengan `MessagingProviderError`/status yang sudah ada, tetapi perlu bukti dari error nyata sebelum menganggap kode tertentu universal. |
| Delivery-rate adaptation | Ambil secara hati-hati | Receipt terlambat/tidak lengkap; gunakan window minimum dan hanya memperlambat/menjeda, bukan mempercepat otomatis. |
| Reply ratio/contact graph/reputation voucher | Tidak pada V1 | Tidak relevan untuk notifikasi desa dan berisiko menyimpan/menafsirkan data percakapan lebih dari perlu. |
| Typing, presence, circadian/"human entropy", device fingerprint | Tolak | Upaya menyamarkan automasi, tidak diperlukan untuk reliabilitas, dan tidak sejalan dengan kepatuhan. |
| Patch Baileys atau wrapper seluruh socket | Tolak pada fase awal | WAPBB memakai `relayMessage` langsung dan memiliki queue sendiri; wrapper dapat mengubah retry/timing tanpa transaksi job. |

## Arsitektur target

```text
operator -> preview -> campaign DRAFT
                       |
                       +-> start: safety preflight + satu slot account
                                            |
scheduler -> dispatcher lease -> pilih job eligible -> safety governor -> relay Baileys
                                                        |                    |
                                                  defer / pause          receipt/error
                                                        \                    /
                                                         PostgreSQL safety state + audit + UI/alert
```

### Data dan konfigurasi baru

Nama dapat disesuaikan saat implementasi, tetapi desain perlu memisahkan policy dari fakta runtime.

1. `whatsapp_delivery_profiles` satu baris per account:
   - `mode`: `NEW`, `STANDARD`, `PAUSED_RISK`, `MANUAL_HOLD`.
   - `activated_at`, `last_outbound_at`, `warmup_day`, `risk_level`, `risk_reason`, `paused_at`.
   - snapshot policy version; tidak ada data isi chat.
2. Implementasi awal memakai bucket menit/jam/hari langsung pada satu baris `delivery_safety`, dikunci `FOR UPDATE` saat reservasi. Ledger failure dan receipt terpisah menjadi pekerjaan lanjutan.
3. Tambahkan pada `message_jobs`: `not_before` (dapat memakai/merapikan `scheduled_at`), `defer_reason`, dan `risk_policy_version` snapshot. Job yang tertahan tetap `QUEUED`, bukan `FAILED`.
4. Konfigurasi server tervalidasi Zod dan aman secara default:
   - `WA_SAFETY_ENABLED=false` sampai pilot siap
   - `WA_SAFETY_MIN_DELAY_SECONDS`, `WA_SAFETY_MAX_DELAY_SECONDS`
   - `WA_SAFETY_MAX_PER_MINUTE/HOUR/DAY`
   - `WA_SAFETY_RECONNECT_COOLDOWN_SECONDS`.
   Batas warm-up awal ditetapkan konservatif dalam kode; konfigurasi ambang health adaptif masih tahap berikutnya. Angka ini bukan klaim batas aman WhatsApp.

### Keputusan sebelum relay

`DeliverySafetyService.planSend(accountId, job)` berjalan dalam transaksi pendek sebelum job menjadi `PROCESSING`/sebelum relay dan mengembalikan satu dari:

- `ALLOW(notBefore)`: claim hanya bila waktunya tiba; interval berikutnya dihitung dengan jitter terbatas dan quota dicadangkan atomik saat claim, sebelum persiapan pesan.
- `DEFER(until, reason)`: set `scheduled_at`/`not_before`, lepas claim, tambah audit. Tidak mengonsumsi attempt dan tidak memakai `sleep` di HTTP request.
- `PAUSE(reason)`: ubah campaign menjadi `PAUSED`, simpan alasan, dan hentikan dispatcher untuk account tersebut.
- `BLOCK(reason)`: untuk account `NEEDS_REAUTH`, banned/suspended yang terdeteksi, atau manual hold; tidak ada pengiriman lebih lanjut.

Jitter memakai `crypto.randomInt`, dibatasi oleh policy, dan waktu berikutnya disimpan dalam `delivery_safety.next_allowed_at`; crash/restart tidak menghapus pacing. Klasifikasi error 401/403/429/463 memicu jeda bila flag aktif. Penilaian otomatis dari tren receipt masih tahap berikutnya.

### Warm-up dan nomor inaktif

Mode ditentukan dari `activated_at` yang diisi saat account terhubung, serta kembali konservatif setelah inaktif melewati ambang yang dikonfigurasi. Bukan dari umur SIM yang tidak bisa diverifikasi aplikasi.

Pilot awal yang direkomendasikan (bukan jaminan dan harus dapat diubah): hari 1 maksimal 10 pesan consented, lalu 15, 25, 40, 60, 90, 120; minimum delay 45--120 detik per pesan pada fase baru, hanya pada jam operasional lokal. Pesan dilakukan pada penerima yang memang menunggu informasi, bukan pada daftar dingin. Setelah pilot dengan complaint/opt-out/receipt sehat, profile dapat naik ke mode standar sesuai keputusan admin.

Campaign yang melampaui sisa quota **tidak gagal**: sistem menyebarkannya ke hari/jendela berikutnya dan UI menampilkan estimasi durasi serta alasan. Admin tidak mendapat tombol bypass; perubahan policy harus berotorisasi admin dan masuk audit.

### Sinyal risiko dan pemulihan

| Sinyal | Tindakan otomatis yang aman |
| --- | --- |
| reconnect/connection lost | cooldown, tidak menguras queue saat socket baru pulih |
| HTTP/status Baileys 401/403/logged out/forbidden | block account, tandai `NEEDS_REAUTH`, pause semua campaign |
| 463 atau rate-overlimit yang telah diverifikasi dari log nyata | pause `new contact` delivery atau seluruh account sesuai kebijakan; jangan retry otomatis |
| lonjakan relay/lookup failure | turunkan rate; pause bila melewati threshold |
| delivery receipt rendah pada sample minimum dan rentang waktu cukup | turunkan rate atau minta review operator; jangan menyimpulkan ban hanya dari receipt |
| opt-out atau complaint manual | segera nonaktifkan kontak, catat kategori, dan tampilkan pada health |

Pelepasan `PAUSED_RISK` harus manual oleh admin sesudah checklist: account masih valid, tidak ada campaign duplikat, consent/konten diperiksa, cooldown selesai, dan policy yang lebih rendah telah diset. Semua perubahan dicatat pada `messaging_audit`.

## Tahapan implementasi

### Fase 0 — baseline dan keputusan operasional

1. Rekam konfigurasi Render/Neon/cron yang sedang aktif tanpa membuka secret, contoh volume per hari, failure code, reconnect, receipt, opt-out, dan keluhan selama 14 hari.
2. Pastikan cron tidak memanggil dua endpoint/instance produksi berbeda; lakukan cold-start test dan satu pengiriman internal consented.
3. Tentukan owner on-call, jam pengiriman WIB, definisi account baru/inaktif, dan batas pilot yang disetujui. Tanpa ini, jangan mengaktifkan policy default agresif.

### Fase 1 — perbaikan keselamatan yang independen dari anti-ban

1. Batasi secara transaksi menjadi satu campaign `RUNNING` per WhatsApp account; start/resume lain mengembalikan 409 dengan identitas campaign aktif.
2. Tambahkan dashboard dispatch health: terakhir dispatch sukses, alasan 409, queue tertua, oldest eligible job, socket status/reason, serta campaign yang sedang memegang slot.
3. Perjelas UI history/progress bahwa `SENT` adalah `Diserahkan`, bukan `Terkirim`.
4. Tambahkan header keamanan dan review storage token sebagai pekerjaan terpisah agar tidak mengganggu kontrak SIDDes.

### Fase 2 — governor persisten (feature flag masih mati)

1. Buat migration tabel profile/window dan index; backfill profile `STANDARD` untuk nomor eksisting hanya setelah admin meninjau riwayatnya.
2. Implement `DeliverySafetyService`, `SafetyPolicy`, repository atomik, error classification, dan event ledger minimal.
3. Ubah dispatcher agar `DEFER` memperbarui `scheduled_at` dan mengakhiri batch bila job berikutnya belum eligible; tidak ada `setTimeout`/`sleep` antar pesan.
4. Sambungkan provider connection/error/receipt ke service, termasuk cooldown sesudah reconnect.
5. Tambah route admin read-only untuk safety status dan route pause/resume dengan audit; integration SIDDes hanya memperoleh field aman yang memang diperlukan.

### Fase 3 — UI dan guard operator

1. Form campaign menampilkan profile nomor, quota tersisa, minimum/maximum pacing, dan estimasi selesai sebelum preview/start.
2. Saat mode `NEW`/`PAUSED_RISK`, operator melihat alasan dan langkah aman, bukan tombol mempercepat.
3. History menampilkan `Ditunda karena quota`, `Dijeda karena risiko`, dan kode teknis yang disederhanakan dalam bahasa Indonesia.
4. Tambahkan opt-out yang mudah: keyword/route operasional yang mengubah `whatsappOptIn=false` segera, serta penegasan kategori consent saat import.

### Fase 4 — pilot dan rollout

1. Deploy migration dan kode dengan `WA_SAFETY_ENABLED=false`; lakukan smoke test queue tanpa pesan eksternal.
2. Aktifkan hanya pada satu nomor pilot dan satu campaign kecil kepada penerima yang sudah consent. Gunakan policy konservatif, observasi receipt/failure/opt-out/reconnect.
3. Setelah minimal satu siklus warm-up dan review manual, perluas bertahap. Jangan menaikkan limit otomatis hanya karena queue panjang.
4. Rollback: matikan feature flag untuk menghentikan keputusan governor baru; profile/counter tidak dihapus. Untuk risiko tinggi gunakan pause campaign, bukan mematikan guard lalu mengirim burst.

## Rencana pengujian dan acceptance gate

Unit:

- limit/window/warm-up lintas tengah malam WIB, restart, inaktif, jitter bounded, dan policy config invalid;
- counter atomik pada dua dispatcher bersaing;
- `ALLOW/DEFER/PAUSE/BLOCK`, cooldown reconnect, error classification, serta tidak menaikkan attempts saat defer;
- tidak ada auto-retry pada result tidak pasti; stable ID dan receipt lama tetap tidak bisa mengubah generation baru.

Integration PostgreSQL:

- dua start/resume bersamaan hanya menghasilkan satu `RUNNING`;
- batch 50 tidak melakukan relay berturut-turut saat governor aktif; job sisanya dijadwalkan ulang;
- restart di antara claim dan relay mempertahankan jadwal/counter;
- threshold risk menjeda campaign atomik dan dispatcher selanjutnya tidak mengirim;
- opt-out saat menunggu selalu menjadi `SKIPPED` sebelum relay.

Manual/staging:

- QR/restore/reconnect pada environment non-produksi dengan nomor uji berizin;
- cron timeout/cold start, socket unavailable, database transient failure, dan recovery lease;
- browser desktop/mobile untuk copy peringatan dan tidak adanya bypass;
- pilot penerima nyata hanya dengan persetujuan eksplisit dan log insiden yang sudah ditentukan.

Gate produksi: semua test di atas lulus, `npm audit --omit=dev` bersih, migration rollback/restore teruji, observability tersedia, owner operasi menyetujui policy pilot, dan tidak ada claim "anti-ban terjamin" dalam UI/dokumentasi.

## Urutan prioritas implementasi

1. Satu campaign aktif + observabilitas dispatch (menghilangkan misleading state sekarang).
2. Governor database: min interval, quota window, defer, dan post-reconnect cooldown.
3. Warm-up persisten dan guard UI/estimasi campaign.
4. Risk health, auto-pause, alert, serta pilot.
5. Hardening auth/browser dan evaluasi pindah ke WhatsApp Business Platform bila volume/SLA menuntut jalur resmi.

## Referensi yang ditinjau

- WhatsApp Business Messaging Policy, terutama kewajiban nomor/opt-in, penghormatan opt-out, dan konsekuensi feedback pengguna: <https://whatsappbusiness.com/policy/>.
- WhatsApp Messaging Guidelines dan Terms of Service: bulk/auto-messaging atau penggunaan tidak sah tetap dapat mengakibatkan tindakan terhadap akun: <https://www.whatsapp.com/legal/messaging-guidelines>, <https://www.whatsapp.com/legal/terms-of-service?list_view=true>.
- `kobie3717/baileys-antiban`: <https://github.com/kobie3717/baileys-antiban>. Digunakan sebagai referensi pola teknis, bukan jaminan efektivitas atau rekomendasi untuk patch/socket wrapper di produksi.
