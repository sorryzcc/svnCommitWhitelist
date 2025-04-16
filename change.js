// 使用正则表达式匹配并提取结尾为 _001 或 _002 的部分
const matchResult = data.ClientText.formData.InGameKey.match(/_(00[12])$/);

// 检查是否有匹配结果，并安全地设置 lastNumber
state.lastNumber = matchResult ? matchResult[1] : null;


const InGameKey = data.ClientText.formData.InGameKey;
const context = data.ClientText.formData.Context;

// 提取 InGameKey 的各个部分
state.key1 = InGameKey.split('_')[0] || '';
state.key2 = InGameKey.split('_')[1] || '';
state.key3 = InGameKey.split('_')[2] || '';
state.key4 = InGameKey.split('_')[3] || '';
state.key5 = InGameKey.split('_')[4] || '';
state.origin = data.ClientText.formData.Origin
state.used = data.ClientText.formData.Used
state.version = data.ClientText.formData.Version
state.platform = data.ClientText.formData.Platform
state.subKey = data.ClientText.formData.InGameKey
state.region = data.ClientText.formData.Region

// 提取 Where: 之后，What: 之前的文本
const whereMatch = context.match(/Where:\s*(.*?)\s*What:/);
const whereParts = whereMatch ? whereMatch[1].split('_') : [];

// 提取 Where: 之后的部分
state.where1 = whereParts[0] || '';
state.where2 = whereParts[1] || '';
state.where3 = whereParts[2] || '';
state.where4 = whereParts[3] || '';
state.where5 = whereParts[4] || '';

// 提取 What: 之后的部分
const whatMatch = context.match(/What:\s*((?:(?!How:|Where:).)*)/s);
state.what = whatMatch ? whatMatch[1].trim() : '';

// 提取 How: 之后的部分
const howMatch = context.match(/How:\s*(.*?)(?:\s*Where:|$)/s);
state.how = howMatch ? howMatch[1].trim() : '';

// 提取场景信息
const textSceneInformation1Match = context.match(/^\s*(B|M|J)/);
state.textSceneInformation1 = textSceneInformation1Match ? textSceneInformation1Match[1] : '';

const textSceneInformation2Match = context.match(/(B|M|J)(\d+)(?=\s*How:)/);
state.textSceneInformation2 = textSceneInformation2Match ? textSceneInformation2Match[2] : '';

if (state.where2 == '') {
    state.clickWhereCount = 0;
} else if (state.where3 == '') {
    state.clickWhereCount = 1;
} else if (state.where4 == '') {
    state.clickWhereCount = 2;
} else if (state.where5 == '') {
    state.clickWhereCount = 3;
} else {
    state.clickWhereCount = 4;
}

console.log(state.clickWhereCount,'state.clickWhereCount');