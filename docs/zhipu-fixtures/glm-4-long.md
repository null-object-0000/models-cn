> ## Documentation Index
>
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# GLM-4-Long

## 概览

GLM-4-Long 是一款专为处理超长文本和记忆型任务而设计的语言模型，支持 1M 超长输入（150-200 万字）。

> **价格**
>
> 1 元 / 百万 Tokens

> **输入模态**
>
> 文本

> **输出模态**
>
> 文本

> **上下文窗口**
>
> 1M

> **最大输出 Tokens**
>
> 4K

## 推荐场景

> **财报解读**
>
> 可处理数百页的年度财报，自动提取营收结构、风险提示、管理层讨论等关键信息，生成结构化分析报告；通过记忆历史财务数据，对比多期财报的趋势变化，识别潜在财务异常点。

> **论文读取**
>
> 支持解析数万字的学术论文，自动梳理研究背景、实验方法、结论等核心章节，将内容分主题输出；结合领域知识库，对跨章节的理论推导进行逻辑验证，辅助研究者快速定位创新点与论证漏洞。

> **小说阅读**
>
> 深度分析百万字长篇小说的人物关系网、情节脉络，生成特定内容总结；基于对全文风格的记忆，实现高质量续写，保持叙事连贯性与文学性。

> **法律文书分析**
>
> 处理海量法律条文、判例和合同文本，精准提取权利义务条款、责任界定等关键内容；通过记忆类似案例，辅助律师进行法律风险评估与诉讼策略制定。

## 使用资源

> **[体验中心](https://bigmodel.cn/trialcenter/modeltrial/text?modelCode=glm-4-long)**
>
> 快速测试模型在业务场景上的效果

> **[接口文档](/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8)**
>
> API 调用方式

## 详细介绍

### 1. 超长文本处理能力

支持高达 1M（约 150-200 万字）的上下文长度，相当于 2 本《红楼梦》或 125 篇论文，在超长文本处理方面的有十分强大的能力。

### 2. 推理能力

不仅能够阅读和翻译长篇文档，还能够进行全局分析，例如分析财务报告和提取关键信息、合同条款和科研数据。GLM-4-Long 已经具备一定的推理和记忆能力，能够理解和回应复杂的查询，创建具有超长记忆的聊天机器人。

### 3. 技术关键点

在继续预训练（Continue Pre-Training）、监督微调（SFT）和基于人类反馈的强化学习（RLHF）阶段，进行混合训练逐步扩展上下文长度，从最初的2K上下文支持发展到1M上下文支持。

## 调用示例

以下是一个完整的调用示例，帮助您快速上手 GLM-4-Long 模型。

**Python**

**安装 SDK**

```bash theme={null}
# 安装最新版本
pip install zai-sdk
# 或指定版本
pip install zai-sdk==0.2.3
```

**验证安装**

```python theme={null}
import zai
print(zai.__version__)
```

**调用示例**

```python theme={null}
from zai import ZhipuAiClient

# 初始化客户端
client = ZhipuAiClient(api_key="YOUR_API_KEY")

# 创建聊天完成请求
response = client.chat.completions.create(
    model="glm-4-long",
    messages=[
        {"role": "user", "content": "请分析这份长篇技术文档的核心要点和技术架构...[此处可以输入非常长的文档内容]"}
    ]
)

# 获取回复
print(response.choices[0].message.content)
```

**Java**

**安装 SDK**

**Maven**

```xml theme={null}
<dependency>
    <groupId>ai.z.openapi</groupId>
    <artifactId>zai-sdk</artifactId>
    <version>0.3.5</version>
</dependency>
```

**Gradle (Groovy)**

```groovy theme={null}
implementation 'ai.z.openapi:zai-sdk:0.3.5'
```

**调用示例**

```java theme={null}
import ai.z.openapi.ZhipuAiClient;
import ai.z.openapi.service.model.ChatCompletionCreateParams;
import ai.z.openapi.service.model.ChatCompletionResponse;
import ai.z.openapi.service.model.ChatMessage;
import ai.z.openapi.service.model.ChatMessageRole;
import java.util.Arrays;

public class BasicChat {
    public static void main(String[] args) {
        // 初始化客户端
        ZhipuAiClient client = ZhipuAiClient.builder().ofZHIPU()
            .apiKey("YOUR_API_KEY")
            .build();

        // 创建聊天完成请求
        ChatCompletionCreateParams request = ChatCompletionCreateParams.builder()
            .model("glm-4-long")
            .messages(Arrays.asList(
                ChatMessage.builder()
                    .role(ChatMessageRole.USER.value())
                    .content("请分析这份长篇技术文档的核心要点和技术架构...[此处可以输入非常长的文档内容]")
                    .build()
            ))
            .build();

        // 发送请求
        ChatCompletionResponse response = client.chat().createChatCompletion(request);

        // 获取回复
        if (response.isSuccess()) {
            Object reply = response.getData().getChoices().get(0).getMessage().getContent();
            System.out.println("AI 回复: " + reply);
        } else {
            System.err.println("错误: " + response.getMsg());
        }
    }
}
```

**Python（旧）**

```python theme={null}
from zhipuai import ZhipuAI

client = ZhipuAI(api_key="YOUR_API_KEY") # 填写您自己的 APIKey
response = client.chat.completions.create(
    model="glm-4-long",  # 填写需要调用的模型编码
    messages=[
        {"role": "system", "content": "你是一个文档分析专家，擅长从长篇技术文档中提取关键信息和架构要点，能够提供结构化的分析报告。"},
        {"role": "user", "content": "请分析这份长篇技术文档的核心要点和技术架构...[此处可以输入非常长的文档内容]"}
    ],
)
print(response.choices[0].message)
```

## 用户并发权益

API 调用会受到速率限制，当前我们限制的维度是请求并发数量（在途请求任务数量）。不同等级的用户并发保障如下。

| V0  | V1  | V2  | V3  |
| --- | --- | --- | --- |
| 10  | 30  | 40  | 50  |

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
