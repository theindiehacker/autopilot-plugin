// 依存の向きの検査 (architecture プラグインの標準)。internal/ に置き、go test ./... で動かす。
// モジュールは internal/<モジュール>/ から見つけるため、モジュールを足しても書き換えない。
// 見るのは直接の import だけ。_test.go と、testdata・. や _ で始まるディレクトリは見ない
package internal

import (
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// モジュールの中の層。上の層は下の層を import できるが、逆はできない。"" はモジュールの直下 (core.go)
var layers = []string{"", "middleware", "port", "application", "domain", "exception"}

// domain を import できる場所。受け付ける側のアダプター (resource・messaging・tool) は application を通す
var domainImporters = []string{"", "application", "domain", "port/adapter/persistence", "port/adapter/service"}

// どのモジュールからも使える技術的なコード。shared からモジュールは使えない
const shared = "shared"

// 移行中で、まだ直していない import だけを "<import する側> -> <import される側>" (internal/ からのパッケージのパス) で並べる。
// 例: "billing/domain/model/invoice -> billing/application/invoice"。直したら消す
var exceptions = []string{}

func TestArchitecture(t *testing.T) {
	prefix := modulePath(t) + "/internal/"
	fset := token.NewFileSet()
	err := filepath.WalkDir(".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if n := d.Name(); p != "." && (n == "testdata" || strings.HasPrefix(n, ".") || strings.HasPrefix(n, "_")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, p, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		from := filepath.ToSlash(filepath.Dir(p))
		for _, imp := range f.Imports {
			ip, _ := strconv.Unquote(imp.Path.Value)
			if !strings.HasPrefix(ip, prefix) {
				continue
			}
			to := strings.TrimPrefix(ip, prefix)
			if slices.Contains(exceptions, from+" -> "+to) {
				continue
			}
			if msg := check(from, to); msg != "" {
				t.Errorf("internal/%s: %s を import しています。%s", fset.Position(imp.Pos()), ip, msg)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// check は、internal/ からの相対パスで from が to を import してよいかを調べ、いけなければ理由を返す
func check(from, to string) string {
	fm, fr := split(from)
	tm, tr := split(to)
	switch {
	case fm == ".":
		// internal の直下には、このテストのほかに置かない
		return ""
	case fm == shared:
		if tm != shared {
			return "shared はモジュールを import できません"
		}
		return ""
	case tm == shared:
		return ""
	case fm != tm:
		if under(fr, "port/adapter/service/*/adapter") && under(tr, "port/adapter/resource") {
			return ""
		}
		return "モジュールは別のモジュールを import できません。ドメインイベントで連携するか、腐敗防止層 (port/adapter/service/<相手>/adapter) から相手の port/adapter/resource を呼んでください"
	}
	fl, tl := layer(fr), layer(tr)
	if fl < 0 || tl < 0 {
		// 層でないディレクトリは見ない
		return ""
	}
	if fl > tl {
		return fmt.Sprintf("%s は上の層の %s を import できません", name(fl), name(tl))
	}
	if layers[tl] == "domain" {
		for _, p := range domainImporters {
			if (p == "" && fr == "") || (p != "" && under(fr, p)) {
				return ""
			}
		}
		return "domain を import できるのは、core・application・port/adapter/persistence・port/adapter/service だけです。application を通してください"
	}
	return ""
}

// split は "billing/domain/model" を、モジュール "billing" と残り "domain/model" に分ける
func split(p string) (string, string) {
	m, rest, _ := strings.Cut(p, "/")
	return m, rest
}

// layer は、モジュールの中のパスの層の番号を返す。層でなければ -1
func layer(rest string) int {
	first, _, _ := strings.Cut(rest, "/")
	for i, l := range layers {
		if l == first {
			return i
		}
	}
	return -1
}

func name(i int) string {
	if layers[i] == "" {
		return "core"
	}
	return layers[i]
}

// under は、p が pattern (path.Match の書き方を / ごとに当てる) か、その下にあるかを返す
func under(p, pattern string) bool {
	ps, qs := strings.Split(p, "/"), strings.Split(pattern, "/")
	if p == "" || len(ps) < len(qs) {
		return false
	}
	for i, q := range qs {
		if ok, _ := path.Match(q, ps[i]); !ok {
			return false
		}
	}
	return true
}

// modulePath は、go.mod の module の行を読む
func modulePath(t *testing.T) string {
	b, err := os.ReadFile("../go.mod")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(b), "\n") {
		if m, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			m, _, _ = strings.Cut(m, "//")
			return strings.Trim(strings.TrimSpace(m), `"`)
		}
	}
	t.Fatal("go.mod に module の行がありません")
	return ""
}

// TestArchitectureRules は、check が想定どおりに判定することを確かめる (check を直したら、ここも直す)
func TestArchitectureRules(t *testing.T) {
	for _, c := range []struct {
		from, to string
		ok       bool
	}{
		{"billing", "billing/port/adapter/resource/invoice", true},
		{"billing/application/invoice", "billing/domain/model/invoice", true},
		{"billing/port/adapter/persistence/repository", "billing/domain/model/invoice", true},
		{"billing/port/adapter/resource/invoice", "billing/application/invoice", true},
		{"billing/domain/model/invoice", "billing/exception", true},
		{"billing/domain/model/invoice", "shared/db", true},
		{"billing/port/adapter/service/identity/adapter", "identity/port/adapter/resource/user", true},
		{"billing/migration", "billing/application/invoice", true},
		{"billing/domain/model/invoice", "billing/application/invoice", false},
		{"billing/application/invoice", "billing/port/adapter/resource/invoice", false},
		{"billing/port/adapter/resource/invoice", "billing/domain/model/invoice", false},
		{"billing/middleware", "billing/domain/model/invoice", false},
		{"billing/application/invoice", "identity/domain/model/user", false},
		{"billing/port/adapter/service/identity/adapter", "identity/domain/model/user", false},
		{"shared/db", "billing/application/invoice", false},
	} {
		if got := check(c.from, c.to) == ""; got != c.ok {
			t.Errorf("%s → %s: 許すか = %v (想定: %v)", c.from, c.to, got, c.ok)
		}
	}
}
